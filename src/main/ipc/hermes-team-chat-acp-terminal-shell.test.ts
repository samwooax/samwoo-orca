import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  createHermesAcpTerminalEnvironment,
  resolveHermesAcpTerminalInvocation
} from './hermes-team-chat-acp-terminal-shell'

const { resolveGitBashPathMock, resolveWindowsGitBashShellPathMock } = vi.hoisted(() => ({
  resolveGitBashPathMock: vi.fn(),
  resolveWindowsGitBashShellPathMock: vi.fn()
}))
const { parseWslPathMock, toLinuxPathMock } = vi.hoisted(() => ({
  parseWslPathMock: vi.fn(),
  toLinuxPathMock: vi.fn()
}))

vi.mock('../git-bash', () => ({
  resolveGitBashPath: resolveGitBashPathMock,
  resolveWindowsGitBashShellPath: resolveWindowsGitBashShellPathMock
}))
vi.mock('../wsl', () => ({ parseWslPath: parseWslPathMock, toLinuxPath: toLinuxPathMock }))

let platformDescriptor: PropertyDescriptor | undefined

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

function storeWithShell(shell: string) {
  return { getSettings: () => ({ terminalWindowsShell: shell }) } as never
}

beforeEach(() => {
  platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  resolveGitBashPathMock.mockReset().mockReturnValue(null)
  resolveWindowsGitBashShellPathMock.mockReset().mockReturnValue(null)
  parseWslPathMock.mockReset().mockReturnValue(null)
  toLinuxPathMock.mockReset().mockImplementation((value: string) => value)
})

afterEach(() => {
  if (platformDescriptor) {
    Object.defineProperty(process, 'platform', platformDescriptor)
  }
})

describe('Hermes ACP terminal shell selection', () => {
  it('copies only allowlisted environment values and adds deterministic process controls', () => {
    expect(
      createHermesAcpTerminalEnvironment({
        Path: 'C:\\safe',
        TEMP: 'C:\\temp',
        AWS_SECRET_ACCESS_KEY: 'secret',
        SAMWOO_TOKEN: 'secret',
        NO_COLOR: 'override'
      })
    ).toEqual({
      Path: 'C:\\safe',
      TEMP: 'C:\\temp',
      NO_COLOR: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      PYTHONUTF8: '1'
    })
  })

  it('uses POSIX sh without user startup files on non-Windows hosts', () => {
    setPlatform('linux')

    expect(
      resolveHermesAcpTerminalInvocation({
        commandText: 'printf ok',
        root: '/repo',
        store: storeWithShell('ignored'),
        environment: { PATH: '/usr/bin', SECRET: 'hidden' }
      })
    ).toEqual({
      command: '/bin/sh',
      args: ['-c', 'printf ok'],
      cwd: '/repo',
      env: {
        PATH: '/usr/bin',
        NO_COLOR: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: '1'
      }
    })
  })

  it('prioritizes Git Bash for native Windows projects', () => {
    setPlatform('win32')
    resolveGitBashPathMock.mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')

    const result = resolveHermesAcpTerminalInvocation({
      commandText: 'node test.js',
      root: 'C:\\repo',
      store: storeWithShell('powershell.exe'),
      environment: { PATH: 'C:\\bin' }
    })

    expect(result).toMatchObject({
      command: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['--noprofile', '--norc', '-c', 'node test.js'],
      cwd: 'C:\\repo'
    })
    expect(resolveWindowsGitBashShellPathMock).not.toHaveBeenCalled()
  })

  it('uses an isolated WSL shell for WSL UNC projects', () => {
    setPlatform('win32')
    parseWslPathMock.mockReturnValue({ distro: 'Ubuntu', linuxPath: '/home/me/repo' })
    toLinuxPathMock.mockReturnValue('/home/me/repo')

    const result = resolveHermesAcpTerminalInvocation({
      commandText: 'pnpm test',
      root: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
      store: storeWithShell('powershell.exe'),
      environment: { PATH: 'C:\\bin', TOKEN: 'hidden' }
    })

    expect(result.command).toBe('wsl.exe')
    expect(result.cwd).toBe(process.cwd())
    expect(result.args).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/me/repo',
      '--',
      'env',
      '-i',
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      'PYTHONIOENCODING=utf-8',
      'PYTHONUNBUFFERED=1',
      'PYTHONUTF8=1',
      'TERM=dumb',
      'sh',
      '-c',
      'pnpm test'
    ])
    expect(resolveGitBashPathMock).not.toHaveBeenCalled()
  })

  it.each([
    ['cmd.exe', ['cmd.exe', ['/d', '/s', '/c', 'chcp 65001>nul & echo ok']]],
    [
      'powershell.exe',
      [
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; echo ok'
        ]
      ]
    ]
  ])('falls back to the configured Windows shell: %s', (shell, expected) => {
    setPlatform('win32')

    const result = resolveHermesAcpTerminalInvocation({
      commandText: 'echo ok',
      root: 'C:\\repo',
      store: storeWithShell(shell),
      environment: {}
    })

    expect([result.command, result.args]).toEqual(expected)
    expect(result.cwd).toBe('C:\\repo')
    expect(result.windowsVerbatimArguments).toBe(shell === 'cmd.exe' ? true : undefined)
  })

  it.runIf(process.platform === 'win32')(
    'preserves nested quotes and UTF-8 output through the real cmd fallback',
    () => {
      setPlatform('win32')
      const result = resolveHermesAcpTerminalInvocation({
        commandText: 'node -e "process.stdout.write(String.fromCharCode(54620,44544))"',
        root: process.cwd(),
        store: storeWithShell('cmd.exe')
      })
      const child = spawnSync(result.command, result.args, {
        cwd: result.cwd,
        env: result.env,
        encoding: 'utf8',
        windowsHide: true,
        windowsVerbatimArguments: result.windowsVerbatimArguments
      })

      expect(child.status).toBe(0)
      expect(child.stdout).toBe('한글')
    }
  )

  it('uses PowerShell when Git Bash is unavailable and the configured shell is WSL', () => {
    setPlatform('win32')

    const result = resolveHermesAcpTerminalInvocation({
      commandText: 'echo ok',
      root: 'C:\\repo',
      store: storeWithShell('wsl.exe'),
      environment: {}
    })

    expect(result.command).toBe('powershell.exe')
    expect(result.args).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; echo ok'
    ])
  })
})
