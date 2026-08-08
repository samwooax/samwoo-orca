import { spawn, type ChildProcess } from 'node:child_process'
import { connect, createServer } from 'node:net'
import { ipcMain } from 'electron'
import {
  SAMWOO_HERMES_DASHBOARD_PORT,
  SAMWOO_HERMES_SSH_HOST
} from '../../shared/samwoo-service-endpoints'

export type HermesTunnelResult = {
  ok: boolean
  /** Local loopback port forwarded to the remote dashboard; present when ok. */
  port?: number
  error?: string
}

// Why: one persistent SSH `-L` tunnel per (host, remotePort) is reused across
// every profile pick, so switching team bots reuses the same forward instead of
// spawning a tunnel per click. Keyed by "host:remotePort".
type Tunnel = { localPort: number; proc: ChildProcess }
const tunnels = new Map<string, Tunnel>()

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        srv.close(() => resolvePort(port))
      } else {
        srv.close(() => reject(new Error('could not allocate a local port')))
      }
    })
  })
}

function waitForLocalPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolveReady) => {
    const attempt = (): void => {
      const client = connect({ host: '127.0.0.1', port }, () => {
        client.end()
        resolveReady(true)
      })
      client.on('error', () => {
        client.destroy()
        if (Date.now() > deadline) {
          resolveReady(false)
        } else {
          setTimeout(attempt, 200)
        }
      })
    }
    attempt()
  })
}

async function ensureTunnel(host: string, remotePort: number): Promise<HermesTunnelResult> {
  const key = `${host}:${remotePort}`
  const existing = tunnels.get(key)
  if (existing && existing.proc.exitCode === null) {
    return { ok: true, port: existing.localPort }
  }

  const localPort = await findFreePort()
  // Why: -N (no remote command), ExitOnForwardFailure so a bind clash fails fast,
  // ServerAlive* so a dropped tunnel is detected and the process exits (freeing
  // the map entry) instead of hanging a stale forward.
  const args = [
    '-N',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
    '-L',
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    host
  ]
  const proc = spawn('ssh', args, { stdio: 'ignore' })
  const tunnel: Tunnel = { localPort, proc }
  tunnels.set(key, tunnel)
  proc.on('exit', () => {
    if (tunnels.get(key) === tunnel) {
      tunnels.delete(key)
    }
  })

  const ready = await waitForLocalPort(localPort, 10_000)
  if (!ready) {
    proc.kill()
    tunnels.delete(key)
    return { ok: false, error: `tunnel to ${host} did not become ready` }
  }
  return { ok: true, port: localPort }
}

/** SAMWOO-ORCA: forward the remote Hermes dashboard's loopback port to a local
 *  loopback port so Orca can open the auth-free web chat in a browser tab. */
export function registerHermesDashboardTunnelHandlers(): void {
  ipcMain.handle(
    'hermes:ensureDashboardTunnel',
    async (_event, args?: { host?: string; remotePort?: number }): Promise<HermesTunnelResult> => {
      const host = args?.host?.trim() || SAMWOO_HERMES_SSH_HOST
      const remotePort = args?.remotePort ?? SAMWOO_HERMES_DASHBOARD_PORT
      try {
        return await ensureTunnel(host, remotePort)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}

export function shutdownHermesDashboardTunnels(): void {
  for (const { proc } of tunnels.values()) {
    proc.kill()
  }
  tunnels.clear()
}
