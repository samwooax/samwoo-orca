import { spawn } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTeamChatCancelRemoteCommand } from './hermes-team-chat-models'

const CANCEL_TIMEOUT_MS = 15_000
function createSshMuxArgs(): string[] {
  if (process.platform === 'win32') {
    return []
  }
  try {
    const owner = typeof process.getuid === 'function' ? process.getuid() : process.pid
    const socketDirectory = join(tmpdir(), `samwoo-orca-ssh-${owner}`)
    mkdirSync(socketDirectory, { recursive: true, mode: 0o700 })
    if (lstatSync(socketDirectory).isSymbolicLink()) {
      return []
    }
    chmodSync(socketDirectory, 0o700)
    return [
      '-o',
      'ControlMaster=auto',
      '-o',
      `ControlPath=${join(socketDirectory, '%C')}`,
      '-o',
      'ControlPersist=10m'
    ]
  } catch {
    return []
  }
}

const SSH_MUX_ARGS = createSshMuxArgs()

export function isValidTeamChatSshHost(host: string): boolean {
  return /^(?!-)[A-Za-z0-9@.:_-]+$/.test(host)
}

export function teamChatSshArgs(host: string, remote: string): string[] {
  return [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    ...SSH_MUX_ARGS,
    host,
    remote
  ]
}

export function stopRemoteTeamChat(host: string, runId: string): Promise<boolean> {
  return new Promise((resolveStop) => {
    const proc = spawn('ssh', teamChatSshArgs(host, buildTeamChatCancelRemoteCommand(runId)), {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let output = ''
    let settled = false
    const finish = (stopped: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolveStop(stopped)
    }
    const timer = setTimeout(() => {
      proc.kill()
      finish(false)
    }, CANCEL_TIMEOUT_MS)
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    proc.on('error', () => finish(false))
    proc.on('close', (code) => finish(code === 0 && output.trim() === 'stopped'))
  })
}
