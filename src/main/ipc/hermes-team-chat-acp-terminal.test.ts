import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HermesAcpTerminal } from './hermes-team-chat-acp-terminal'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  resolveAuthorizedPath: vi.fn(),
  resolveDirectory: vi.fn(),
  resolveInvocation: vi.fn(),
  killWithDescendantSweep: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./filesystem-auth', () => ({ resolveAuthorizedPath: mocks.resolveAuthorizedPath }))
vi.mock('./hermes-team-chat-acp-terminal-directory', () => ({
  resolveHermesAcpTerminalDirectory: mocks.resolveDirectory
}))
vi.mock('./hermes-team-chat-acp-terminal-shell', () => ({
  resolveHermesAcpTerminalInvocation: mocks.resolveInvocation
}))
vi.mock('../pty-descendant-termination', () => ({
  killWithDescendantSweep: mocks.killWithDescendantSweep
}))

type FakeChild = EventEmitter & {
  pid: number
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

const store = {} as never
const active = () => true
let root = ''
let children: FakeChild[] = []
let terminals: HermesAcpTerminal[] = []

function fakeChild(pid = 4_242): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    child.emit('close', null, typeof signal === 'string' ? signal : null)
    return true
  })
  children.push(child)
  return child
}

function createParams(command = 'printf ok') {
  return {
    command,
    cwd: '/workspace',
    args: [],
    env: [],
    outputByteLimit: 64 * 1024,
    _meta: { samwoo: { shellText: true, background: false, timeoutSeconds: 1 } }
  }
}

async function createTerminal() {
  const terminal = await HermesAcpTerminal.create({ cwd: root, store })
  terminals.push(terminal)
  return terminal
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-acp-terminal-'))
  children = []
  terminals = []
  mocks.spawn.mockReset().mockImplementation(() => fakeChild())
  mocks.resolveAuthorizedPath.mockReset().mockResolvedValue(root)
  mocks.resolveDirectory.mockReset().mockResolvedValue(root)
  mocks.resolveInvocation.mockReset().mockReturnValue({
    command: '/bin/sh',
    args: ['-c', 'printf ok'],
    cwd: root,
    env: { PATH: '/usr/bin' }
  })
  mocks.killWithDescendantSweep.mockReset().mockImplementation(async (_pid, killRoot) => {
    killRoot()
  })
})

afterEach(async () => {
  await Promise.all(terminals.map((terminal) => terminal.close()))
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

describe('HermesAcpTerminal', () => {
  it('creates a command without approval and exposes bounded output and exit status', async () => {
    const terminal = await createTerminal()

    const created = (await terminal.handle(
      'terminal/create',
      createParams(),
      1,
      active,
      new AbortController().signal
    )) as { terminalId: string }

    expect(mocks.spawn).toHaveBeenCalledWith('/bin/sh', ['-c', 'printf ok'], {
      cwd: root,
      env: { PATH: '/usr/bin' },
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true
    })
    expect(children[0].stdin.end).toHaveBeenCalledOnce()

    children[0].stdout.emit('data', Buffer.from('hello\u001b[31m red\u001b[0m'))
    await expect(
      terminal.handle(
        'terminal/output',
        { terminalId: created.terminalId },
        1,
        active,
        new AbortController().signal
      )
    ).resolves.toMatchObject({ output: 'hello red', truncated: false, exitStatus: null })

    const waited = terminal.handle(
      'terminal/wait_for_exit',
      { terminalId: created.terminalId },
      1,
      active,
      new AbortController().signal
    )
    children[0].emit('close', 0, null)
    await expect(waited).resolves.toEqual({ exitCode: 0, signal: null })
  })

  it('preserves UTF-8 characters split across output chunks', async () => {
    const terminal = await createTerminal()
    const created = (await terminal.handle(
      'terminal/create',
      createParams(),
      1,
      active,
      new AbortController().signal
    )) as { terminalId: string }
    const encoded = Buffer.from('한글')
    children[0].stdout.emit('data', encoded.subarray(0, 2))
    children[0].stdout.emit('data', encoded.subarray(2))

    await expect(
      terminal.handle(
        'terminal/output',
        { terminalId: created.terminalId },
        1,
        active,
        new AbortController().signal
      )
    ).resolves.toMatchObject({ output: '한글' })
  })

  it('rejects a fifth live command at the terminal capacity', async () => {
    const terminal = await createTerminal()
    const creations = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        terminal.handle(
          'terminal/create',
          createParams(`command-${index}`),
          1,
          active,
          new AbortController().signal
        )
      )
    )

    await expect(
      terminal.handle(
        'terminal/create',
        createParams('over-capacity'),
        1,
        active,
        new AbortController().signal
      )
    ).rejects.toThrow('capacity is reached')

    expect(creations).toHaveLength(4)
    expect(mocks.spawn).toHaveBeenCalledTimes(4)
    for (const child of children) {
      child.emit('close', 0, null)
    }
  })

  it('kills descendant processes and release removes the terminal record', async () => {
    const terminal = await createTerminal()
    const created = (await terminal.handle(
      'terminal/create',
      createParams('node server.js'),
      2,
      active,
      new AbortController().signal
    )) as { terminalId: string }

    await expect(
      terminal.handle(
        'terminal/kill',
        { terminalId: created.terminalId },
        2,
        active,
        new AbortController().signal
      )
    ).resolves.toBeNull()
    expect(mocks.killWithDescendantSweep).toHaveBeenCalledWith(
      4_242,
      expect.any(Function),
      expect.objectContaining({ ownsRoot: expect.any(Function) })
    )
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')

    await expect(
      terminal.handle(
        'terminal/output',
        { terminalId: created.terminalId },
        2,
        active,
        new AbortController().signal
      )
    ).resolves.toMatchObject({ exitStatus: { exitCode: null, signal: 'killed' } })
    await terminal.handle(
      'terminal/release',
      { terminalId: created.terminalId },
      2,
      active,
      new AbortController().signal
    )
    await expect(
      terminal.handle(
        'terminal/output',
        { terminalId: created.terminalId },
        2,
        active,
        new AbortController().signal
      )
    ).rejects.toThrow('does not exist')
  })

  it('terminates a foreground command when its bounded timeout expires', async () => {
    vi.useFakeTimers()
    const terminal = await createTerminal()
    const created = (await terminal.handle(
      'terminal/create',
      createParams('long-running'),
      3,
      active,
      new AbortController().signal
    )) as { terminalId: string }
    const waited = terminal.handle(
      'terminal/wait_for_exit',
      { terminalId: created.terminalId },
      3,
      active,
      new AbortController().signal
    )

    await vi.advanceTimersByTimeAsync(1_000)

    await expect(waited).resolves.toEqual({ exitCode: null, signal: 'timeout' })
    expect(mocks.killWithDescendantSweep).toHaveBeenCalledOnce()
  })

  it('returns one memoized close operation while descendant cleanup is pending', async () => {
    let releaseCleanup = (): void => {}
    mocks.killWithDescendantSweep.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCleanup = resolve
        })
    )
    const terminal = await createTerminal()
    await terminal.handle(
      'terminal/create',
      createParams('long-running'),
      3,
      active,
      new AbortController().signal
    )

    const first = terminal.close()
    const second = terminal.close()

    expect(second).toBe(first)
    await vi.waitFor(() => expect(mocks.killWithDescendantSweep).toHaveBeenCalledOnce())
    releaseCleanup()
    await first
  })

  it('never spawns when the turn is cancelled before or during command setup', async () => {
    const cancelled = await createTerminal()
    await expect(
      cancelled.handle(
        'terminal/create',
        createParams('cancelled'),
        4,
        () => false,
        new AbortController().signal
      )
    ).rejects.toThrow('cancelled')
    expect(mocks.spawn).not.toHaveBeenCalled()

    let releaseDirectory = (_root: string): void => {}
    mocks.resolveDirectory.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        releaseDirectory = resolve
      })
    )
    const pending = await createTerminal()
    let canContinue = true
    const creation = pending.handle(
      'terminal/create',
      createParams('cancelled-during-setup'),
      5,
      () => canContinue,
      new AbortController().signal
    )
    canContinue = false
    releaseDirectory(root)

    await expect(creation).rejects.toThrow('cancelled')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects bridge metadata, argv, and environment injection before spawn', async () => {
    const terminal = await createTerminal()

    await expect(
      terminal.handle(
        'terminal/create',
        { ...createParams(), _meta: undefined },
        6,
        active,
        new AbortController().signal
      )
    ).rejects.toThrow('did not come from the local bridge')
    await expect(
      terminal.handle(
        'terminal/create',
        { ...createParams(), _meta: { _meta: { samwoo: { shellText: true } } } },
        6,
        active,
        new AbortController().signal
      )
    ).rejects.toThrow('did not come from the local bridge')
    await expect(
      terminal.handle(
        'terminal/create',
        { ...createParams(), args: ['--unsafe'] },
        6,
        active,
        new AbortController().signal
      )
    ).rejects.toThrow('arguments or environment are not supported')
    await expect(
      terminal.handle(
        'terminal/create',
        { ...createParams(), env: [{ name: 'TOKEN', value: 'secret' }] },
        6,
        active,
        new AbortController().signal
      )
    ).rejects.toThrow('arguments or environment are not supported')
    await expect(
      terminal.handle(
        'terminal/create',
        createParams('echo safe\u202eevil'),
        6,
        active,
        new AbortController().signal
      )
    ).rejects.toThrow('command is invalid')
    await expect(
      terminal.handle(
        'terminal/create',
        createParams(`echo unsafe${String.fromCharCode(0x1b)}[31m`),
        6,
        active,
        new AbortController().signal
      )
    ).rejects.toThrow('command is invalid')

    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
