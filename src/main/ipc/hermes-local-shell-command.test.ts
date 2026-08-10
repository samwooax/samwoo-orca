import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelLocalShellCommand, runLocalShellCommand } from './hermes-local-shell-command'

const { resolveAuthorizedPathMock, spawnMock, statMock } = vi.hoisted(() => ({
  resolveAuthorizedPathMock: vi.fn(),
  spawnMock: vi.fn(),
  statMock: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('node:fs/promises', () => ({ stat: statMock }))
vi.mock('./filesystem-auth', () => ({ resolveAuthorizedPath: resolveAuthorizedPathMock }))

type FakeProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function fakeProcess(): FakeProcess {
  const child = new EventEmitter() as FakeProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit('close', null))
    return true
  })
  return child
}

const store = {
  getSettings: () => ({ terminalWindowsShell: 'powershell.exe', terminalWindowsWslDistro: '' })
} as never

beforeEach(() => {
  resolveAuthorizedPathMock.mockReset().mockResolvedValue('C:\\project')
  statMock.mockReset().mockResolvedValue({ isDirectory: () => true })
  spawnMock.mockReset()
})

describe('runLocalShellCommand', () => {
  it('runs the full command through the configured terminal shell', async () => {
    const child = fakeProcess()
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('clean\n'))
        child.emit('close', 0)
      })
      return child
    })

    const result = await runLocalShellCommand({
      requestId: 'request-1',
      command: 'git status --short | findstr src',
      cwd: 'C:\\project',
      store
    })

    expect(result).toMatchObject({ ok: true, status: 'completed', exitCode: 0, output: 'clean\n' })
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['git status --short | findstr src']),
      expect.objectContaining({ cwd: 'C:\\project', shell: false })
    )
  })

  it('cancels an active command through the shared chat request id', async () => {
    const child = fakeProcess()
    spawnMock.mockReturnValue(child)
    const pending = runLocalShellCommand({
      requestId: 'request-2',
      command: 'npm test',
      cwd: 'C:\\project',
      store
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(cancelLocalShellCommand('request-2')).toBe(true)
    await expect(pending).resolves.toMatchObject({
      ok: false,
      status: 'cancelled',
      error: 'command cancelled'
    })
    expect(child.kill).toHaveBeenCalledOnce()
  })
})
