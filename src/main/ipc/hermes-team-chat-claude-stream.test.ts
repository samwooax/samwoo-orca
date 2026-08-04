import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import { runClaudeStreamProcess } from './hermes-team-chat-claude-stream'

type FakeProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
}

function claudeProcess(lines: unknown[]): FakeProcess {
  const proc = new EventEmitter() as FakeProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = {
    end: vi.fn(),
    write: vi.fn(() => {
      queueMicrotask(() => {
        proc.stdout.emit(
          'data',
          Buffer.from(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
        )
        proc.emit('close', 0)
      })
      return true
    })
  }
  return proc
}

describe('runClaudeStreamProcess', () => {
  it('returns the final result and reports Claude tool activity', async () => {
    const proc = claudeProcess([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Read',
              input: { file_path: 'src/a.ts' }
            }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'secret' }]
        }
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '확인했습니다.'
      }
    ])
    const progress: TeamChatProgressEvent[] = []

    const result = await runClaudeStreamProcess({
      proc: proc as never,
      requestId: 'request-1',
      message: '확인해줘',
      stdinPrefix: 'mail-secret\n',
      onProgress: (event) => progress.push(event)
    })

    expect(result).toEqual({ ok: true, reply: '확인했습니다.' })
    expect(progress).toContainEqual(
      expect.objectContaining({
        id: 'tool-1',
        detail: 'src/a.ts',
        status: 'in_progress'
      })
    )
    expect(progress).toContainEqual(expect.objectContaining({ id: 'tool-1', status: 'completed' }))
    expect(JSON.stringify(progress)).not.toContain('secret')
    expect(proc.stdin.write).toHaveBeenCalledWith('mail-secret\n확인해줘')
  })
})
