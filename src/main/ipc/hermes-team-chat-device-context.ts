import { spawn } from 'node:child_process'
import { isIP } from 'node:net'
import { userInfo } from 'node:os'

const TAILSCALE_STATUS_TIMEOUT_MS = 5_000

export type TeamChatDeviceContext = {
  laptopName: string
  laptopUser: string
  tailscaleIpv4: string
  cwd: string
}

type TailscaleSelfStatus = {
  Self?: {
    HostName?: unknown
    DNSName?: unknown
    TailscaleIPs?: unknown
  }
}

export function parseTeamChatTailscaleIdentity(output: string): {
  laptopName: string
  tailscaleIpv4: string
} {
  try {
    const self = (JSON.parse(output) as TailscaleSelfStatus).Self
    const ips = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : []
    return {
      laptopName: typeof self?.HostName === 'string' ? self.HostName : '',
      tailscaleIpv4:
        ips.find((value): value is string => typeof value === 'string' && isIP(value) === 4) ?? ''
    }
  } catch {
    return { laptopName: '', tailscaleIpv4: '' }
  }
}

function safeUserName(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

function cleanContextValue(value: string): string {
  return value.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('\0', ' ').trim()
}

function readTailscaleIdentity(): Promise<{
  laptopName: string
  tailscaleIpv4: string
}> {
  return new Promise((resolveIdentity) => {
    const tailscale =
      process.platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale'
    const proc = spawn(tailscale, ['status', '--self', '--json'], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let output = ''
    let settled = false
    const finish = (identity = { laptopName: '', tailscaleIpv4: '' }): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolveIdentity(identity)
    }
    const timer = setTimeout(() => {
      proc.kill()
      finish()
    }, TAILSCALE_STATUS_TIMEOUT_MS)
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    proc.on('error', () => finish())
    proc.on('close', () => {
      finish(parseTeamChatTailscaleIdentity(output))
    })
  })
}

let cachedIdentity: { laptopName: string; tailscaleIpv4: string } | null = null

export async function getTeamChatDeviceContext(cwd: string): Promise<TeamChatDeviceContext> {
  if (!cachedIdentity?.tailscaleIpv4) {
    // Why: Tailscale may become ready after app startup; an empty first probe must not disable laptop access for the whole session.
    cachedIdentity = await readTailscaleIdentity()
  }
  return {
    laptopName: cleanContextValue(cachedIdentity.laptopName),
    laptopUser: cleanContextValue(safeUserName()),
    tailscaleIpv4: cachedIdentity.tailscaleIpv4,
    cwd: cleanContextValue(cwd)
  }
}

export function formatTeamChatDeviceContext(context: TeamChatDeviceContext): string {
  const identity = JSON.stringify({
    laptopName: context.laptopName,
    laptopUser: context.laptopUser,
    tailscaleIpv4: context.tailscaleIpv4,
    cwd: context.cwd
  })
  const boundary = context.tailscaleIpv4
    ? `이 요청의 로컬 장비는 ${context.tailscaleIpv4} 하나뿐입니다. SSH와 파일 작업은 이 IP에만 수행하고, 메모리나 이전 대화에 나온 다른 장비 IP는 사용하지 마세요.`
    : '현재 장비의 Tailscale IPv4를 확인하지 못했습니다. 어떤 노트북에도 SSH하거나 원격 파일 작업을 수행하지 마세요.'
  return `[작업컨텍스트] ${identity}\n[장비접근제한] ${boundary}\n`
}
