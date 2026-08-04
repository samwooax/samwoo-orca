import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatLocalCommandResults,
  parseLocalCommandRequest,
  type LocalCommandRequest
} from './hermes-local-command-protocol'
import { executeLocalCommandRequest } from './hermes-local-project-commands'

const { isCommandOnLocalPathMock, resolveAuthorizedPathMock, spawnMock, statMock } = vi.hoisted(
  () => ({
    isCommandOnLocalPathMock: vi.fn(),
    resolveAuthorizedPathMock: vi.fn(),
    spawnMock: vi.fn(),
    statMock: vi.fn()
  })
)

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('node:fs/promises', () => ({ stat: statMock }))
vi.mock('./command-path-resolver', () => ({
  isCommandOnLocalPath: isCommandOnLocalPathMock
}))
vi.mock('./filesystem-auth', () => ({
  resolveAuthorizedPath: resolveAuthorizedPathMock
}))

type FakeProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function fakeProcess(start: (process: FakeProcess) => void): FakeProcess {
  const process = new EventEmitter() as FakeProcess
  process.stdout = new EventEmitter()
  process.stderr = new EventEmitter()
  process.kill = vi.fn()
  queueMicrotask(() => start(process))
  return process
}

function request(operations: LocalCommandRequest['operations']): LocalCommandRequest {
  return { version: 1, operations }
}

beforeEach(() => {
  spawnMock.mockReset()
  isCommandOnLocalPathMock.mockReset().mockResolvedValue(true)
  resolveAuthorizedPathMock.mockReset().mockResolvedValue('/project')
  statMock.mockReset().mockResolvedValue({ isDirectory: () => true })
})

describe('parseLocalCommandRequest', () => {
  it('accepts only an exact structured command envelope', () => {
    const valid =
      '<orca_local_commands>{"version":1,"operations":[{"id":"run-1","kind":"run","command":"uv","args":["run","app.py"],"mode":"foreground"}]}</orca_local_commands>'
    expect(parseLocalCommandRequest(valid)?.operations).toEqual([
      {
        id: 'run-1',
        kind: 'run',
        command: 'uv',
        args: ['run', 'app.py'],
        mode: 'foreground'
      }
    ])
    expect(parseLocalCommandRequest(`설명\n${valid}`)).toBeNull()
    expect(
      parseLocalCommandRequest(
        '<orca_local_commands>{"version":1,"operations":[{"id":"run-1","kind":"run","command":"bash","args":["-c","rm -rf ."],"mode":"foreground"}]}</orca_local_commands>'
      )
    ).toBeNull()
  })

  it('rejects duplicate ids and malformed stop requests', () => {
    expect(
      parseLocalCommandRequest(
        '<orca_local_commands>{"version":1,"operations":[{"id":"x","kind":"stop","processId":"one"},{"id":"x","kind":"stop","processId":"two"}]}</orca_local_commands>'
      )
    ).toBeNull()
    expect(
      parseLocalCommandRequest(
        '<orca_local_commands>{"version":1,"operations":[{"id":"x","kind":"stop","processId":"../outside"}]}</orca_local_commands>'
      )
    ).toBeNull()
  })

  it('formats command results in a dedicated envelope', () => {
    expect(formatLocalCommandResults([{ id: 'x', ok: true, status: 'completed' }])).toBe(
      '<orca_local_command_results>{"version":1,"results":[{"id":"x","ok":true,"status":"completed"}]}</orca_local_command_results>'
    )
  })
})

describe('executeLocalCommandRequest', () => {
  it('runs a foreground command directly in the authorized project', async () => {
    spawnMock.mockImplementation(() =>
      fakeProcess((process) => {
        process.stdout.emit('data', Buffer.from('done'))
        process.emit('close', 0)
      })
    )

    const [result] = await executeLocalCommandRequest({
      cwd: '/project',
      store: {} as never,
      request: request([
        {
          id: 'run',
          kind: 'run',
          command: 'uv',
          args: ['run', 'app.py'],
          mode: 'foreground'
        }
      ])
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'uv',
      ['run', 'app.py'],
      expect.objectContaining({ cwd: '/project', shell: false })
    )
    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      exitCode: 0,
      output: 'done'
    })
  })

  it('tracks and stops a background Streamlit process within the same project', async () => {
    let process: FakeProcess | undefined
    spawnMock.mockImplementation(() => {
      process = fakeProcess((child) => {
        child.stderr.emit('data', Buffer.from('Local URL: http://localhost:8501'))
      })
      return process
    })
    const [started] = await executeLocalCommandRequest({
      cwd: '/project',
      store: {} as never,
      request: request([
        {
          id: 'start',
          kind: 'run',
          command: 'streamlit',
          args: ['run', 'app.py'],
          mode: 'background'
        }
      ])
    })
    const [stopped] = await executeLocalCommandRequest({
      cwd: '/project',
      store: {} as never,
      request: request([{ id: 'stop', kind: 'stop', processId: started.processId as string }])
    })

    expect(started).toMatchObject({
      ok: true,
      status: 'running',
      url: 'http://localhost:8501'
    })
    expect(stopped).toMatchObject({
      ok: true,
      status: 'stopped',
      processId: started.processId
    })
    expect(process?.kill).toHaveBeenCalled()
  })

  it('does not spawn when the executable is unavailable', async () => {
    isCommandOnLocalPathMock.mockResolvedValue(false)
    const [result] = await executeLocalCommandRequest({
      cwd: '/project',
      store: {} as never,
      request: request([
        {
          id: 'run',
          kind: 'run',
          command: 'uv',
          args: ['run', 'app.py'],
          mode: 'foreground'
        }
      ])
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'command is not installed: uv'
    })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
