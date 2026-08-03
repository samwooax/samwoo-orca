import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import { runHermesAcpProcess } from './hermes-team-chat-acp-client'

type FakeProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
}

function emitJson(proc: FakeProcess, value: unknown): void {
  proc.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`))
}

function acpProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = {
    end: vi.fn(),
    write: vi.fn((line: string) => {
      const request = JSON.parse(line) as {
        id: number
        params: Record<string, unknown>
      }
      queueMicrotask(() => {
        if (request.id === 0) {
          emitJson(proc, {
            jsonrpc: '2.0',
            id: 0,
            result: { protocolVersion: 1 }
          })
        } else if (request.id === 1) {
          emitJson(proc, {
            jsonrpc: '2.0',
            id: 1,
            result: { sessionId: 'session-1' }
          })
        } else if (request.id === 2 || request.id === 3) {
          emitJson(proc, { jsonrpc: '2.0', id: request.id, result: {} })
        } else if (request.id === 4) {
          emitJson(proc, {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: '파일을 확인합니다.' }
              }
            }
          })
          emitJson(proc, {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'tool-1',
                title: 'Read',
                status: 'in_progress',
                locations: [{ path: 'src/a.ts' }]
              }
            }
          })
          emitJson(proc, {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'tool-1',
                status: 'completed',
                content: [
                  {
                    type: 'content',
                    content: { type: 'text', text: 'secret' }
                  }
                ]
              }
            }
          })
          emitJson(proc, {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: '완료했습니다.' }
              }
            }
          })
          emitJson(proc, {
            jsonrpc: '2.0',
            id: 4,
            result: { stopReason: 'end_turn' }
          })
        }
      })
      return true
    })
  }
  return proc
}

describe('runHermesAcpProcess', () => {
  it('runs the ACP turn and exposes concise progress without tool output', async () => {
    const proc = acpProcess()
    const progress: TeamChatProgressEvent[] = []

    const result = await runHermesAcpProcess({
      proc: proc as never,
      requestId: 'request-1',
      profile: 'ai_center',
      modelId: 'gpt-5.6-sol',
      message: 'src/a.ts 확인',
      onProgress: (event) => progress.push(event)
    })

    expect(result).toEqual({ ok: true, reply: '완료했습니다.' })
    expect(progress).toContainEqual(
      expect.objectContaining({
        id: 'tool-1',
        detail: 'src/a.ts',
        status: 'completed'
      })
    )
    expect(JSON.stringify(progress)).not.toContain('secret')
    expect(proc.stdin.end).toHaveBeenCalled()
  })
})
