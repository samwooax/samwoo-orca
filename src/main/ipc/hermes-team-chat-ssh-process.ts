import { spawn } from 'node:child_process'
import { buildTeamChatCancelRemoteCommand } from './hermes-team-chat-models'

const CANCEL_TIMEOUT_MS = 15_000
const SSH_MUX_ARGS =
  process.platform === 'win32'
    ? []
    : [
        '-o',
        'ControlMaster=auto',
        '-o',
        'ControlPath=/tmp/.samwoo-orca-ssh-%r@%h-%p',
        '-o',
        'ControlPersist=10m'
      ]

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
