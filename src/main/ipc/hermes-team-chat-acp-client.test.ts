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

function acpProcess(
  options: {
    clientRequestMethod?: string
    clientRequestParams?: Record<string, unknown>
    acceptClientResult?: boolean
    trailingClientRequest?: Record<string, unknown>
  } = {}
): FakeProcess {
  let promptCount = 0
  let pendingProbePromptId: number | undefined
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
      params?: Record<string, unknown>
      error?: { code?: number }
      result?: unknown
    }
    queueMicrotask(() => {
      if (request.method === 'initialize') {
        emitJson(proc, {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: { loadSession: true, promptCapabilities: { image: true } }
          }
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
        const prompt = Array.isArray(request.params?.prompt) ? request.params.prompt : []
        if ((prompt[0] as { text?: unknown } | undefined)?.text === '대기') {
          return
        }
        if (options.clientRequestMethod) {
          pendingProbePromptId = request.id
          emitJson(proc, {
            jsonrpc: '2.0',
            id: request.id,
            method: options.clientRequestMethod,
            params: options.clientRequestParams ?? {
              path: 'C:\\private\\probe-secret.txt',
              command: 'print-secret',
              content: 'file-secret'
            }
          })
          return
        }
        if (options.trailingClientRequest) {
          emitJson(proc, {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'done' }
              }
            }
          })
          proc.stdout.emit(
            'data',
            Buffer.from(
              `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } })}\n${JSON.stringify(options.trailingClientRequest)}\n`
            )
          )
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
      } else if (
        (request.error?.code === -32_000 ||
          request.error?.code === -32_601 ||
          (options.acceptClientResult && 'result' in request)) &&
        request.id === pendingProbePromptId
      ) {
        emitJson(proc, {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'probe observed' }
            }
          }
        })
        emitJson(proc, {
          jsonrpc: '2.0',
          id: pendingProbePromptId,
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
    expect(outbound.find((request) => request.method === 'session/new')?.params).toMatchObject({
      cwd: '/opt/data/profiles/ai_center'
    })
    expect(outbound.filter((request) => request.method === 'session/prompt')).toHaveLength(2)
    expect(outbound.find((request) => request.method === 'initialize')?.params).toMatchObject({
      clientCapabilities: {}
    })
    expect(outbound.filter((request) => request.method === 'session/set_config_option')).toEqual([
      expect.objectContaining({
        params: { sessionId: 'session-1', configId: 'reasoning_effort', value: 'xhigh' }
      })
    ])
    expect(outbound.some((request) => request.method === 'session/set_mode')).toBe(false)
    expect(proc.stdin.end).not.toHaveBeenCalled()
    await session.close()
    expect(proc.stdin.end).toHaveBeenCalledOnce()
  })

  it('advertises and observes fs requests without resolving a colliding agent request', async () => {
    const proc = acpProcess({ clientRequestMethod: 'fs/read_text_file' })
    const logs: string[] = []
    const session = new HermesAcpSession(proc as never, 'ai_center', '', {
      capabilityProbe: {
        mode: 'fs',
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        sessionCwd: 'C:\\selected'
      },
      log: (line) => logs.push(line)
    })

    const result = await session.prompt({
      requestId: 'request-probe',
      modelId: 'gpt-5.6-sol',
      effort: 'high',
      message: 'read the probe file'
    })
    const outbound = proc.stdin.write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.trimStart().startsWith('{'))
      .map((line) => JSON.parse(line))

    expect(result).toEqual({ ok: true, reply: 'probe observed' })
    expect(outbound.find((request) => request.method === 'initialize')?.params).toMatchObject({
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }
    })
    expect(outbound.find((request) => request.method === 'session/new')?.params).toMatchObject({
      cwd: 'C:\\selected'
    })
    expect(outbound).toContainEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: -32_000 })
      })
    )
    expect(logs.join('\n')).toContain('fs/read_text_file')
    expect(logs.join('\n')).toContain('agentCapabilities')
    expect(logs.join('\n')).not.toMatch(/private|probe-secret|print-secret|file-secret/)
  })

  it('serves a local filesystem request without changing the remote profile cwd', async () => {
    const proc = acpProcess({
      clientRequestMethod: 'fs/read_text_file',
      clientRequestParams: { sessionId: 'session-1', path: '/workspace/src/a.ts' },
      acceptClientResult: true
    })
    const handle = vi.fn().mockResolvedValue({ content: 'local content' })
    const session = new HermesAcpSession(proc as never, 'ai_center', '', {
      localFiles: {
        capability: {
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          localTerminal: false,
          projectRoot: 'C:\\selected'
        },
        filesystem: { handle, resetReadRevisions: vi.fn() } as never
      }
    })

    await expect(
      session.prompt({
        requestId: 'request-local-files',
        modelId: 'gpt-5.6-sol',
        effort: 'high',
        message: 'read the local file'
      })
    ).resolves.toEqual({ ok: true, reply: 'probe observed' })
    const outbound = proc.stdin.write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.trimStart().startsWith('{'))
      .map((line) => JSON.parse(line))

    expect(handle).toHaveBeenCalledWith(
      'fs/read_text_file',
      {
        sessionId: 'session-1',
        path: '/workspace/src/a.ts'
      },
      expect.any(Function)
    )
    expect(outbound.find((request) => request.method === 'initialize')?.params).toMatchObject({
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }
    })
    expect(outbound.find((request) => request.method === 'session/new')?.params).toMatchObject({
      cwd: '/opt/data/profiles/ai_center'
    })
    expect(outbound).toContainEqual(
      expect.objectContaining({ result: { content: 'local content' } })
    )
  })

  it('ends local file authority before processing a trailing request in the same chunk', async () => {
    const proc = acpProcess({
      trailingClientRequest: {
        jsonrpc: '2.0',
        id: 'late-write',
        method: 'fs/write_text_file',
        params: { sessionId: 'session-1', path: '/workspace/a.txt', content: 'late' }
      }
    })
    const handle = vi.fn()
    const session = new HermesAcpSession(proc as never, 'ai_center', '', {
      localFiles: {
        capability: {
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          localTerminal: false,
          projectRoot: 'C:\\selected'
        },
        filesystem: { handle, resetReadRevisions: vi.fn() } as never
      }
    })

    await expect(
      session.prompt({
        requestId: 'request-trailing-write',
        modelId: 'gpt-5.6-sol',
        effort: 'high',
        message: 'finish'
      })
    ).resolves.toEqual({ ok: true, reply: 'done' })
    expect(handle).not.toHaveBeenCalled()
  })

  it('routes terminal requests only when the local terminal capability is active', async () => {
    const proc = acpProcess({
      clientRequestMethod: 'terminal/create',
      clientRequestParams: {
        sessionId: 'session-1',
        command: 'git status',
        cwd: '/workspace',
        _meta: { samwoo: { shellText: true } }
      },
      acceptClientResult: true
    })
    const terminal = {
      isSupportedMethod: vi.fn((method: unknown) => method === 'terminal/create'),
      handle: vi.fn().mockResolvedValue({ terminalId: 'terminal-1' }),
      endGeneration: vi.fn(),
      cancelGeneration: vi.fn(),
      close: vi.fn()
    }
    const session = new HermesAcpSession(proc as never, 'ai_center', '', {
      localFiles: {
        capability: {
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true
          },
          localTerminal: true,
          projectRoot: 'C:\\selected'
        },
        filesystem: { handle: vi.fn(), resetReadRevisions: vi.fn() } as never,
        terminal: terminal as never
      }
    })

    await expect(
      session.prompt({
        requestId: 'request-local-terminal',
        modelId: 'gpt-5.6-sol',
        effort: 'high',
        message: 'run git status'
      })
    ).resolves.toEqual({ ok: true, reply: 'probe observed' })
    expect(terminal.handle).toHaveBeenCalledWith(
      'terminal/create',
      expect.objectContaining({ command: 'git status', sessionId: 'session-1' }),
      expect.any(Number),
      expect.any(Function),
      expect.any(AbortSignal)
    )
  })

  it('ignores malformed or mixed JSON-RPC envelopes instead of executing them', async () => {
    const proc = acpProcess()
    const handle = vi.fn()
    const session = new HermesAcpSession(proc as never, 'ai_center', '', {
      localFiles: {
        capability: {
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          localTerminal: false,
          projectRoot: 'C:\\selected'
        },
        filesystem: { handle, resetReadRevisions: vi.fn() } as never
      }
    })
    const pending = session.prompt({
      requestId: 'request-invalid-envelope',
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
    emitJson(proc, {
      jsonrpc: '2.0',
      id: 91,
      method: 'fs/write_text_file',
      result: null,
      params: { sessionId: 'session-1', path: '/workspace/a.txt', content: 'unsafe' }
    })
    emitJson(proc, {
      id: 92,
      method: 'fs/write_text_file',
      params: { sessionId: 'session-1', path: '/workspace/b.txt', content: 'unsafe' }
    })
    expect(handle).not.toHaveBeenCalled()
    const promptRequest = proc.stdin.write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.trimStart().startsWith('{'))
      .map((line) => JSON.parse(line))
      .find((message) => message.method === 'session/prompt')
    emitJson(proc, {
      jsonrpc: '2.0',
      id: promptRequest.id,
      method: null,
      result: { stopReason: 'end_turn' }
    })
    emitJson(proc, {
      jsonrpc: '2.0',
      id: promptRequest.id,
      result: { stopReason: 'cancelled' }
    })
    await expect(pending).resolves.toEqual({ ok: false, error: 'cancelled' })
  })

  it('becomes closed immediately and ignores late local file requests', async () => {
    const proc = acpProcess()
    const handle = vi.fn()
    const session = new HermesAcpSession(proc as never, 'ai_center', '', {
      localFiles: {
        capability: {
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          localTerminal: false,
          projectRoot: 'C:\\selected'
        },
        filesystem: { handle, resetReadRevisions: vi.fn() } as never
      }
    })

    await session.close()
    emitJson(proc, {
      jsonrpc: '2.0',
      id: 99,
      method: 'fs/write_text_file',
      params: { sessionId: 'session-1', path: '/workspace/a.txt', content: 'late' }
    })

    expect(session.isClosed).toBe(true)
    expect(proc.stdin.end).toHaveBeenCalledOnce()
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects an unknown agent request before response correlation', async () => {
    const proc = acpProcess({ clientRequestMethod: 'client/unknown' })
    const session = new HermesAcpSession(proc as never, 'ai_center', '', {
      capabilityProbe: {
        mode: 'fs',
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        sessionCwd: 'C:\\selected'
      },
      log: vi.fn()
    })

    await expect(
      session.prompt({
        requestId: 'request-unknown-method',
        modelId: 'gpt-5.6-sol',
        effort: 'medium',
        message: 'probe'
      })
    ).resolves.toEqual({ ok: true, reply: 'probe observed' })
    const outbound = proc.stdin.write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.trimStart().startsWith('{'))
      .map((line) => JSON.parse(line))
    expect(outbound).toContainEqual(
      expect.objectContaining({ error: { code: -32_601, message: expect.any(String) } })
    )
  })

  it('cancels permission requests while the probe is active', async () => {
    const proc = acpProcess()
    const session = new HermesAcpSession(proc as never, 'ai_center', '', {
      capabilityProbe: {
        mode: 'terminal',
        clientCapabilities: { terminal: true },
        sessionCwd: 'C:\\selected'
      },
      log: vi.fn()
    })
    const pending = session.prompt({
      requestId: 'request-probe-permission',
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

    emitJson(proc, {
      jsonrpc: '2.0',
      id: 99,
      method: 'session/request_permission',
      params: {
        options: [
          { optionId: 'once', kind: 'allow_once' },
          { optionId: 'always', kind: 'allow_always' }
        ]
      }
    })
    await vi.waitFor(() => {
      const response = proc.stdin.write.mock.calls
        .map(([line]) => String(line))
        .filter((line) => line.trimStart().startsWith('{'))
        .map((line) => JSON.parse(line))
        .find((message) => message.id === 99 && message.result)
      expect(response?.result).toEqual({ outcome: { outcome: 'cancelled' } })
    })
    const promptRequest = proc.stdin.write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.trimStart().startsWith('{'))
      .map((line) => JSON.parse(line))
      .find((message) => message.method === 'session/prompt')
    emitJson(proc, {
      jsonrpc: '2.0',
      id: promptRequest.id,
      result: { stopReason: 'cancelled' }
    })
    await expect(pending).resolves.toEqual({ ok: false, error: 'cancelled' })
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
