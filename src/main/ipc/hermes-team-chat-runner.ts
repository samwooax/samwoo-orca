import { spawn } from 'node:child_process'
import {
  buildTeamChatCancelRemoteCommand,
  buildTeamChatRemoteCommand,
  formatTeamChatMessage,
  type TeamChatEffort,
  type TeamChatHistoryMessage,
  type TeamChatModelId
} from './hermes-team-chat-models'
import {
  formatTeamChatDeviceContext,
  getTeamChatDeviceContext
} from './hermes-team-chat-device-context'

const MESSAGE_TIMEOUT_MS = 180_000
const CANCEL_TIMEOUT_MS = 15_000
const inFlight = new Map<
  string,
  { proc: ReturnType<typeof spawn>; stop: (reason: 'cancelled' | 'timeout') => Promise<boolean> }
>()

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

function sshArgs(host: string, remote: string): string[] {
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

function stopRemoteTeamChat(host: string, requestId: string): Promise<boolean> {
  return new Promise((resolveStop) => {
    const proc = spawn('ssh', sshArgs(host, buildTeamChatCancelRemoteCommand(requestId)), {
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

export async function runTeamChatMessage(args: {
  requestId: string
  host: string
  profile: string
  modelId: TeamChatModelId
  effort: TeamChatEffort
  message: string
  history: TeamChatHistoryMessage[]
  cwd: string
  mailToken?: string
}): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const deviceContext = await getTeamChatDeviceContext(args.cwd)
  const fullMessage = formatTeamChatMessage({
    contextLine: formatTeamChatDeviceContext(deviceContext),
    history: args.history,
    message: args.message
  })
  const remote = buildTeamChatRemoteCommand({
    requestId: args.requestId,
    profile: args.profile,
    modelId: args.modelId,
    effort: args.effort,
    mailToken: args.mailToken
  })
  return new Promise((resolvePromise) => {
    const proc = spawn('ssh', sshArgs(args.host, remote), { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    let stopping = false
    let deferredResult: { ok: boolean; reply?: string; error?: string } | null = null
    const finish = (result: { ok: boolean; reply?: string; error?: string }): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      inFlight.delete(args.requestId)
      resolvePromise(result)
    }
    const stop = async (reason: 'cancelled' | 'timeout'): Promise<boolean> => {
      if (settled || stopping) {
        return false
      }
      stopping = true
      // Why: UI readiness must follow confirmed remote termination, not merely local SSH disconnection.
      const stopped = await stopRemoteTeamChat(args.host, args.requestId)
      if (!stopped) {
        stopping = false
        if (deferredResult) {
          finish(deferredResult)
        }
        return false
      }
      proc.kill()
      finish({
        ok: false,
        error: reason === 'timeout' ? 'timeout waiting for team agent reply' : 'cancelled'
      })
      return true
    }
    inFlight.set(args.requestId, { proc, stop })
    const timer = setTimeout(() => {
      void stop('timeout')
    }, MESSAGE_TIMEOUT_MS)
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    proc.on('error', (error) => {
      if (!settled) {
        const result = { ok: false, error: error.message }
        if (stopping) {
          deferredResult = result
        } else {
          finish(result)
        }
      }
    })
    proc.on('close', (code) => {
      if (settled) {
        return
      }
      const reply = stdout.trim()
      const result =
        code === 0 && reply
          ? { ok: true, reply }
          : {
              ok: false,
              error:
                code === 124
                  ? 'timeout waiting for team agent reply'
                  : stderr.trim() || `team agent exited with code ${code}`
            }
      if (stopping) {
        deferredResult = result
      } else {
        finish(result)
      }
    })
    proc.stdin.write(fullMessage)
    proc.stdin.end()
  })
}

export async function cancelTeamChatMessage(requestId: string): Promise<boolean> {
  return (await inFlight.get(requestId)?.stop('cancelled')) ?? false
}
