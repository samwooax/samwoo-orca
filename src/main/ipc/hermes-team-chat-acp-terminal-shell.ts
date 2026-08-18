import { basename } from 'node:path'
import type { Store } from '../persistence'
import { resolveGitBashPath, resolveWindowsGitBashShellPath } from '../git-bash'
import { parseWslPath, toLinuxPath } from '../wsl'

export type HermesAcpTerminalInvocation = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  windowsVerbatimArguments?: boolean
}

const SAFE_ENV_NAMES = new Set([
  'APPDATA',
  'COLORTERM',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMSPEC',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR'
])

export function createHermesAcpTerminalEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && SAFE_ENV_NAMES.has(name.toUpperCase())) {
      environment[name] = value
    }
  }
  environment.NO_COLOR = '1'
  environment.PYTHONIOENCODING = 'utf-8'
  environment.PYTHONUNBUFFERED = '1'
  environment.PYTHONUTF8 = '1'
  return environment
}

function shellName(shellPath: string): string {
  return basename(shellPath.replaceAll('\\', '/')).toLowerCase()
}

function windowsFallbackInvocation(
  commandText: string,
  root: string,
  store: Store
): Omit<HermesAcpTerminalInvocation, 'env'> {
  const configuredShell = store.getSettings().terminalWindowsShell?.trim() || 'powershell.exe'
  const configuredName = shellName(configuredShell)
  const configuredBash = resolveWindowsGitBashShellPath(configuredShell)
  if (configuredBash) {
    return {
      command: configuredBash,
      args: ['--noprofile', '--norc', '-c', commandText],
      cwd: root
    }
  }
  if (configuredName === 'cmd.exe' || configuredName === 'cmd') {
    return {
      command: configuredShell,
      args: ['/d', '/s', '/c', `chcp 65001>nul & ${commandText}`],
      cwd: root,
      windowsVerbatimArguments: true
    }
  }
  const powershell =
    configuredName === 'powershell.exe' ||
    configuredName === 'powershell' ||
    configuredName === 'pwsh.exe' ||
    configuredName === 'pwsh'
      ? configuredShell
      : 'powershell.exe'
  return {
    command: powershell,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; ${commandText}`
    ],
    cwd: root
  }
}

export function resolveHermesAcpTerminalInvocation(args: {
  commandText: string
  root: string
  store: Store
  environment?: NodeJS.ProcessEnv
}): HermesAcpTerminalInvocation {
  const env = createHermesAcpTerminalEnvironment(args.environment)
  if (process.platform !== 'win32') {
    return {
      command: '/bin/sh',
      args: ['-c', args.commandText],
      cwd: args.root,
      env
    }
  }

  const wslPath = parseWslPath(args.root)
  if (wslPath) {
    return {
      command: 'wsl.exe',
      args: [
        ...(wslPath.distro ? ['-d', wslPath.distro] : []),
        '--cd',
        toLinuxPath(args.root),
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
        args.commandText
      ],
      cwd: process.cwd(),
      env
    }
  }

  const gitBash = resolveGitBashPath()
  const invocation = gitBash
    ? {
        command: gitBash,
        args: ['--noprofile', '--norc', '-c', args.commandText],
        cwd: args.root
      }
    : windowsFallbackInvocation(args.commandText, args.root, args.store)
  return { ...invocation, env }
}
