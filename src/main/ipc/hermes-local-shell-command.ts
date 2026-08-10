import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Store } from '../persistence'
import { resolveWindowsGitBashShellPath } from '../git-bash'
import { resolveAuthorizedPath } from './filesystem-auth'
import { parseWslPath, toLinuxPath } from '../wsl'

const MAX_OUTPUT_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_COMMAND_CHARS = 32_000

export type LocalShellCommandResult = {
  ok: boolean
  status: 'completed' | 'cancelled'
  exitCode: number | null
  output: string
  error?: string
}

type ShellInvocation = {
  command: string
  args: string[]
  cwd: string
}

type ActiveCommand = {
  process: ChildProcessWithoutNullStreams
  cancel: () => void
}

const activeCommands = new Map<string, ActiveCommand>()

function appendOutput(current: string, chunk: Buffer): string {
  const combined = current + chunk.toString('utf8')
  return Buffer.byteLength(combined) <= MAX_OUTPUT_BYTES
    ? combined
    : Buffer.from(combined).subarray(-MAX_OUTPUT_BYTES).toString('utf8')
}

function shellName(shellPath: string): string {
  return basename(shellPath.replaceAll('\\', '/')).toLowerCase()
}

function resolveShellInvocation(commandText: string, root: string, store: Store): ShellInvocation {
  if (process.platform !== 'win32') {
    return {
      command: process.env.SHELL || '/bin/sh',
      args: ['-lc', commandText],
      cwd: root
    }
  }

  const settings = store.getSettings()
  const configuredShell = settings.terminalWindowsShell?.trim() || 'powershell.exe'
  const wslPath = parseWslPath(root)
  const configuredName = shellName(configuredShell)
  const usesWsl = configuredName === 'wsl.exe' || configuredName === 'wsl' || wslPath !== null
  if (usesWsl) {
    const distro = wslPath?.distro || settings.terminalWindowsWslDistro?.trim()
    const args = [
      ...(distro ? ['-d', distro] : []),
      '--cd',
      toLinuxPath(root),
      '--',
      'sh',
      '-lc',
      commandText
    ]
    return { command: 'wsl.exe', args, cwd: process.cwd() }
  }

  const gitBashPath = resolveWindowsGitBashShellPath(configuredShell)
  if (gitBashPath) {
    return { command: gitBashPath, args: ['-lc', commandText], cwd: root }
  }

  if (configuredName === 'git-bash') {
    throw new Error('Git Bash is not installed')
  }
  if (configuredName === 'cmd.exe' || configuredName === 'cmd') {
    return { command: configuredShell, args: ['/d', '/s', '/c', commandText], cwd: root }
  }
  return {
    command: configuredShell,
    args: ['-NoLogo', '-NonInteractive', '-Command', commandText],
    cwd: root
  }
}

async function resolveProjectRoot(cwd: string, store: Store): Promise<string> {
  if (!cwd.trim()) {
    throw new Error('no local project is selected')
  }
  const root = await resolveAuthorizedPath(cwd, store)
  if (!(await stat(root)).isDirectory()) {
    throw new Error('selected project root is not a directory')
  }
  return root
}

export async function runLocalShellCommand(args: {
  requestId: string
  command: string
  cwd: string
  store: Store
}): Promise<LocalShellCommandResult> {
  const commandText = args.command.trim()
  if (!commandText) {
    throw new Error('command is empty')
  }
  if (commandText.includes('\0')) {
    throw new Error('command contains invalid characters')
  }
  if (commandText.length > MAX_COMMAND_CHARS) {
    throw new Error(`command is too long (maximum ${MAX_COMMAND_CHARS} characters)`)
  }

  const root = await resolveProjectRoot(args.cwd, args.store)
  const invocation = resolveShellInvocation(commandText, root, args.store)
  return new Promise((resolveResult) => {
    let output = ''
    let settled = false
    let cancelled = false
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...globalThis.process.env, PYTHONUNBUFFERED: '1' },
      shell: false,
      windowsHide: true
    })
    activeCommands.set(args.requestId, {
      process: child,
      cancel: () => {
        cancelled = true
        child.kill()
      }
    })
    const finish = (result: LocalShellCommandResult): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      activeCommands.delete(args.requestId)
      resolveResult(result)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      output = appendOutput(output, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output = appendOutput(output, chunk)
    })
    child.on('error', (error) =>
      finish({
        ok: false,
        status: cancelled ? 'cancelled' : 'completed',
        exitCode: null,
        output,
        error: cancelled ? 'command cancelled' : error.message
      })
    )
    child.on('close', (exitCode) =>
      finish({
        ok: !cancelled && exitCode === 0,
        status: cancelled ? 'cancelled' : 'completed',
        exitCode,
        output,
        ...(cancelled
          ? { error: 'command cancelled' }
          : exitCode === 0
            ? {}
            : { error: `command exited with code ${exitCode ?? 'unknown'}` })
      })
    )
    const timer = setTimeout(() => {
      cancelled = true
      child.kill()
      finish({
        ok: false,
        status: 'cancelled',
        exitCode: null,
        output,
        error: 'command timed out after 120 seconds'
      })
    }, DEFAULT_TIMEOUT_MS)
  })
}

export function cancelLocalShellCommand(requestId: string): boolean {
  const active = activeCommands.get(requestId)
  if (!active) {
    return false
  }
  active.cancel()
  return true
}
