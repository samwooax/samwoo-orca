import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import {
  buildTeamChatRemoteCommand,
  formatTeamChatMessage,
  type TeamChatEffort,
  type TeamChatHistoryMessage,
  type TeamChatModelId
} from './hermes-team-chat-models'

const MESSAGE_TIMEOUT_MS = 180_000
const inFlight = new Map<string, ReturnType<typeof spawn>>()

const LAPTOP_USER = (() => {
  try {
    return userInfo().username
  } catch {
    return ''
  }
})()

let cachedLaptopName: string | null = null
function getLaptopName(): Promise<string> {
  if (cachedLaptopName !== null) {
    return Promise.resolve(cachedLaptopName)
  }
  return new Promise((resolveName) => {
    const tailscale =
      process.platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale'
    const proc = spawn(tailscale, ['status', '--self', '--json'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let output = ''
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    const done = (name: string): void => {
      cachedLaptopName = name
      resolveName(name)
    }
    proc.on('error', () => done(''))
    proc.on('close', () => {
      try {
        done(String(JSON.parse(output)?.Self?.HostName ?? ''))
      } catch {
        done('')
      }
    })
  })
}

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

function buildContextLine(laptopName: string, cwd: string): string {
  const parts: string[] = []
  if (laptopName) {
    parts.push(`노트북=${laptopName}`)
  }
  if (LAPTOP_USER) {
    parts.push(`계정=${LAPTOP_USER}`)
  }
  if (cwd) {
    parts.push(`현재폴더=${cwd}`)
  }
  return parts.length ? `[작업컨텍스트 ${parts.join(' ')}]\n` : ''
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
  const laptopName = await getLaptopName()
  const fullMessage = formatTeamChatMessage({
    contextLine: buildContextLine(laptopName, args.cwd),
    history: args.history,
    message: args.message
  })
  const remote = buildTeamChatRemoteCommand({
    profile: args.profile,
    modelId: args.modelId,
    effort: args.effort,
    mailToken: args.mailToken
  })
  return new Promise((resolvePromise) => {
    const proc = spawn(
      'ssh',
      [
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'BatchMode=yes',
        ...SSH_MUX_ARGS,
        args.host,
        remote
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    inFlight.set(args.requestId, proc)
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      proc.kill()
      inFlight.delete(args.requestId)
      resolvePromise({ ok: false, error: 'timeout waiting for team agent reply' })
    }, MESSAGE_TIMEOUT_MS)
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    proc.on('error', (error) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        inFlight.delete(args.requestId)
        resolvePromise({ ok: false, error: error.message })
      }
    })
    proc.on('close', (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      inFlight.delete(args.requestId)
      const reply = stdout.trim()
      resolvePromise(
        code === 0 && reply
          ? { ok: true, reply }
          : { ok: false, error: stderr.trim() || `team agent exited with code ${code}` }
      )
    })
    proc.stdin.write(fullMessage)
    proc.stdin.end()
  })
}

export function cancelTeamChatMessage(requestId: string): boolean {
  const proc = inFlight.get(requestId)
  if (!proc) {
    return false
  }
  proc.kill()
  inFlight.delete(requestId)
  return true
}
