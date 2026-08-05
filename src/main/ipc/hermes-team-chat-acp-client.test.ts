import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import { HermesAcpSession } from './hermes-team-chat-acp-client'

type FakeProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
}

function emitJson(proc: FakeProcess, value: unknown): void {
  proc.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`))
}

function acpProcess(): FakeProcess {
  let promptCount = 0
  const proc = new EventEmitter() as FakeProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = new EventEmitter() as FakeProcess['stdin']
  proc.stdin.end = vi.fn()
  proc.stdin.write = vi.fn((line: string) => {
    if (!line.trimStart().startsWith('{')) {
      return true
    }
    const request = JSON.parse(line) as {
      id?: number
      method?: string
      params: Record<string, unknown>
    }
    queueMicrotask(() => {
      if (request.method === 'initialize') {
        emitJson(proc, {
          jsonrpc: '2.0',
          id: request.id,
          result: { protocolVersion: 1 }
        })
      } else if (request.method === 'session/new') {
        emitJson(proc, {
          jsonrpc: '2.0',
          id: request.id,
          result: { sessionId: 'session-1' }
        })
      } else if (request.method === 'session/set_model') {
        emitJson(proc, { jsonrpc: '2.0', id: request.id, result: {} })
      } else if (request.method === 'session/set_config_option') {
        emitJson(proc, { jsonrpc: '2.0', id: request.id, result: { configOptions: [] } })
      } else if (request.method === 'session/prompt') {
        promptCount += 1
        const prompt = Array.isArray(request.params.prompt) ? request.params.prompt : []
        if ((prompt[0] as { text?: unknown } | undefined)?.text === '대기') {
          return
        }
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
              content: {
                type: 'text',
                text: promptCount === 1 ? '완료했습니다.' : '계속 기억합니다.'
              }
            }
          }
        })
        emitJson(proc, {
          jsonrpc: '2.0',
          id: request.id,
          result: { stopReason: 'end_turn' }
        })
      }
    })
    return true
  })
  return proc
}

describe('runHermesAcpProcess', () => {
  it('reuses one ACP session across prompts without forcing dont_ask', async () => {
    const proc = acpProcess()
    const progress: TeamChatProgressEvent[] = []
    const session = new HermesAcpSession(proc as never, 'ai_center', 'mail-secret')

    const result = await session.prompt({
      requestId: 'request-1',
      modelId: 'gpt-5.6-sol',
      effort: 'xhigh',
      message: 'src/a.ts 확인',
      onProgress: (event) => progress.push(event)
    })
    const continued = await session.prompt({
      requestId: 'request-2',
      modelId: 'gpt-5.6-sol',
      effort: 'xhigh',
      message: '앞 내용을 기억해?',
      onProgress: (event) => progress.push(event)
    })

    expect(result).toEqual({ ok: true, reply: '완료했습니다.' })
    expect(continued).toEqual({ ok: true, reply: '계속 기억합니다.' })
    expect(progress).toContainEqual(
      expect.objectContaining({
        id: 'tool-1',
        detail: 'src/a.ts',
        status: 'completed'
      })
    )
    expect(JSON.stringify(progress)).not.toContain('secret')
    expect(proc.stdin.write.mock.calls[0]?.[0]).toBe('mail-secret\n')
    const outbound = proc.stdin.write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.trimStart().startsWith('{'))
      .map((line) => JSON.parse(line))
    expect(outbound.filter((request) => request.method === 'session/new')).toHaveLength(1)
    expect(outbound.filter((request) => request.method === 'session/prompt')).toHaveLength(2)
    expect(outbound.filter((request) => request.method === 'session/set_config_option')).toEqual([
      expect.objectContaining({
        params: { sessionId: 'session-1', configId: 'reasoning_effort', value: 'xhigh' }
      })
    ])
    expect(outbound.some((request) => request.method === 'session/set_mode')).toBe(false)
    expect(proc.stdin.end).not.toHaveBeenCalled()
    session.close()
    expect(proc.stdin.end).toHaveBeenCalledOnce()
  })

  it('cancels an active prompt without closing its ACP process', async () => {
    const proc = acpProcess()
    const session = new HermesAcpSession(proc as never, 'ai_center')
    const pending = session.prompt({
      requestId: 'request-cancel',
      modelId: 'gpt-5.6-sol',
      effort: 'medium',
      message: '대기'
    })
    await vi.waitFor(() => {
      expect(
        proc.stdin.write.mock.calls.some(
          ([line]) =>
            String(line).trimStart().startsWith('{') &&
            JSON.parse(String(line)).method === 'session/prompt'
        )
      ).toBe(true)
    })

    expect(session.cancel()).toBe(true)
    const outbound = proc.stdin.write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.trimStart().startsWith('{'))
      .map((line) => JSON.parse(line))
    expect(outbound.at(-1)).toMatchObject({
      method: 'session/cancel',
      params: { sessionId: 'session-1' }
    })
    const promptRequest = outbound.find((request) => request.method === 'session/prompt')
    emitJson(proc, {
      jsonrpc: '2.0',
      id: promptRequest.id,
      result: { stopReason: 'cancelled' }
    })
    await expect(pending).resolves.toEqual({ ok: false, error: 'cancelled' })
    expect(proc.stdin.end).not.toHaveBeenCalled()
  })
})
