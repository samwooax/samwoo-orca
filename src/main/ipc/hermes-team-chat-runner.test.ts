import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runTeamChatMessage } from './hermes-team-chat-runner'

const {
  executeLocalFileRequestMock,
  executeLocalCommandRequestMock,
  getTeamChatDeviceContextMock,
  runHermesAcpProcessMock,
  spawnMock
} = vi.hoisted(() => ({
  executeLocalFileRequestMock: vi.fn(),
  executeLocalCommandRequestMock: vi.fn(),
  getTeamChatDeviceContextMock: vi.fn(),
  runHermesAcpProcessMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('./hermes-local-project-files', () => ({
  executeLocalFileRequest: executeLocalFileRequestMock
}))
vi.mock('./hermes-local-project-commands', () => ({
  executeLocalCommandRequest: executeLocalCommandRequestMock
}))
vi.mock('./hermes-team-chat-acp-client', () => ({
  runHermesAcpProcess: runHermesAcpProcessMock
}))
vi.mock('./hermes-team-chat-device-context', () => ({
  getTeamChatDeviceContext: getTeamChatDeviceContextMock,
  formatTeamChatDeviceContext: (context: unknown) => `[작업컨텍스트] ${JSON.stringify(context)}\n`
}))

type FakeProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

function fakeProcess(reply: string): FakeProcess {
  const proc = new EventEmitter() as FakeProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  proc.stdin = {
    write: vi.fn(() => {
      queueMicrotask(() => {
        proc.stdout.emit('data', Buffer.from(reply))
        proc.emit('close', 0)
      })
    }),
    end: vi.fn()
  }
  return proc
}

beforeEach(() => {
  spawnMock.mockReset()
  executeLocalFileRequestMock.mockReset()
  executeLocalCommandRequestMock.mockReset()
  getTeamChatDeviceContextMock.mockReset().mockResolvedValue({
    laptopName: 'EMPLOYEE-PC',
    laptopUser: 'employee',
    projectSelected: true
  })
  runHermesAcpProcessMock.mockReset()
})

describe('runTeamChatMessage local file bridge', () => {
  it('executes a structured request locally and returns the follow-up answer', async () => {
    const toolRequest =
      '<orca_local_files>{"version":1,"operations":[{"id":"read-1","kind":"read","path":"src/a.ts"}]}</orca_local_files>'
    const processes = [fakeProcess(''), fakeProcess('')]
    spawnMock.mockImplementation(() => processes.shift())
    runHermesAcpProcessMock
      .mockResolvedValueOnce({ ok: true, reply: toolRequest })
      .mockResolvedValueOnce({ ok: true, reply: '수정을 완료했습니다.' })
    executeLocalFileRequestMock.mockResolvedValue([
      {
        id: 'read-1',
        ok: true,
        path: 'src/a.ts',
        contentBase64: Buffer.from('const a = 1').toString('base64'),
        sha256: 'a'.repeat(64)
      }
    ])

    const result = await runTeamChatMessage({
      requestId: 'request-1',
      host: 'hermes@100.68.242.83',
      profile: 'hr',
      modelId: 'gpt-5.5',
      effort: 'medium',
      message: 'src/a.ts를 확인해줘',
      imageAttachments: [],
      history: [],
      cwd: 'C:\\selected',
      store: {} as never
    })

    expect(result).toEqual({ ok: true, reply: '수정을 완료했습니다.' })
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(executeLocalFileRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: 'C:\\selected' })
    )
    expect(processes).toHaveLength(0)
  })

  it('sends local results through the outbound request without exposing an inbound IP', async () => {
    const toolRequest =
      '<orca_local_files>{"version":1,"operations":[{"id":"list-1","kind":"list","path":"."}]}</orca_local_files>'
    const first = fakeProcess('')
    const second = fakeProcess('')
    spawnMock.mockImplementationOnce(() => first).mockImplementationOnce(() => second)
    runHermesAcpProcessMock
      .mockResolvedValueOnce({ ok: true, reply: toolRequest })
      .mockResolvedValueOnce({ ok: true, reply: '완료' })
    executeLocalFileRequestMock.mockResolvedValue([{ id: 'list-1', ok: true, entries: [] }])

    await runTeamChatMessage({
      requestId: 'request-2',
      host: 'hermes@100.68.242.83',
      profile: 'hr',
      modelId: 'gpt-5.5',
      effort: 'medium',
      message: '파일 목록',
      imageAttachments: [],
      history: [],
      cwd: 'C:\\selected',
      store: {} as never
    })

    const firstMessage = String(runHermesAcpProcessMock.mock.calls[0]?.[0].message)
    const secondMessage = String(runHermesAcpProcessMock.mock.calls[1]?.[0].message)
    expect(firstMessage).toContain('노트북에 SSH하지 말고')
    expect(firstMessage).not.toContain('tailscaleIpv4')
    expect(secondMessage).toContain('<orca_local_file_results>')
    expect(secondMessage).toContain('"id":"list-1"')
  })

  it('treats ordinary text as a final answer and never executes it', async () => {
    spawnMock.mockReturnValue(fakeProcess(''))
    runHermesAcpProcessMock.mockResolvedValue({
      ok: true,
      reply: '파일을 수정했다고 설명하는 일반 답변'
    })

    const result = await runTeamChatMessage({
      requestId: 'request-3',
      host: 'hermes@100.68.242.83',
      profile: 'hr',
      modelId: 'gpt-5.5',
      effort: 'medium',
      message: '설명해줘',
      imageAttachments: [],
      history: [],
      cwd: 'C:\\selected',
      store: {} as never
    })

    expect(result.ok).toBe(true)
    expect(executeLocalFileRequestMock).not.toHaveBeenCalled()
    expect(executeLocalCommandRequestMock).not.toHaveBeenCalled()
  })

  it('executes a structured local command and returns its URL to the agent', async () => {
    const toolRequest =
      '<orca_local_commands>{"version":1,"operations":[{"id":"serve","kind":"run","command":"streamlit","args":["run","app.py"],"mode":"background"}]}</orca_local_commands>'
    spawnMock.mockImplementation(() => fakeProcess(''))
    runHermesAcpProcessMock
      .mockResolvedValueOnce({ ok: true, reply: toolRequest })
      .mockResolvedValueOnce({
        ok: true,
        reply: '실행했습니다: http://localhost:8501'
      })
    executeLocalCommandRequestMock.mockResolvedValue([
      {
        id: 'serve',
        ok: true,
        status: 'running',
        processId: 'process-1',
        url: 'http://localhost:8501'
      }
    ])

    const result = await runTeamChatMessage({
      requestId: 'request-4',
      host: 'hermes@100.68.242.83',
      profile: 'hr',
      modelId: 'gpt-5.5',
      effort: 'medium',
      message: 'Streamlit 앱을 실행해줘',
      imageAttachments: [],
      history: [],
      cwd: 'C:\\selected',
      store: {} as never
    })

    expect(result).toEqual({
      ok: true,
      reply: '실행했습니다: http://localhost:8501'
    })
    expect(executeLocalCommandRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: 'C:\\selected' })
    )
    expect(String(runHermesAcpProcessMock.mock.calls[0]?.[0].message)).toContain('[로컬명령도구]')
    expect(String(runHermesAcpProcessMock.mock.calls[1]?.[0].message)).toContain(
      '<orca_local_command_results>'
    )
  })
})
