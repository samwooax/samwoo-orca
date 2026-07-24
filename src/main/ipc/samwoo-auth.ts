import { request } from 'node:http'
import { ipcMain } from 'electron'

export type SamwooLoginResult = {
  ok: boolean
  login?: string
  role?: string | null
  profile?: string | null
  label?: string | null
  name?: string
  /** Session handle for mail access (maps to server-held credentials). */
  token?: string
  error?: string
}

// Why: the auth service lives on the VPS host, reachable over Tailscale. Using
// the MagicDNS name keeps it stable across the node's IP changes.
const DEFAULT_AUTH_URL = 'http://100.116.18.119:8823'

function postLogin(
  baseUrl: string,
  login: string,
  password: string
): Promise<SamwooLoginResult> {
  return new Promise((resolvePromise) => {
    let url: URL
    try {
      url = new URL('/login', baseUrl)
    } catch {
      resolvePromise({ ok: false, error: 'invalid auth server url' })
      return
    }
    const payload = JSON.stringify({ login, password })
    const req = request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30_000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          try {
            resolvePromise(JSON.parse(body) as SamwooLoginResult)
          } catch {
            resolvePromise({ ok: false, error: `bad response (${res.statusCode})` })
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolvePromise({ ok: false, error: 'auth server timed out' })
    })
    req.on('error', (error) => {
      resolvePromise({ ok: false, error: error.message })
    })
    req.write(payload)
    req.end()
  })
}

/** SAMWOO-ORCA: verify a groupware login via the tailnet auth service and
 *  return the mapped team-bot role. The password is forwarded once and never
 *  persisted on this side. */
export function registerSamwooAuthHandlers(): void {
  ipcMain.handle(
    'samwoo:login',
    async (
      _event,
      args: { login?: string; password?: string; authUrl?: string }
    ): Promise<SamwooLoginResult> => {
      const login = args?.login?.trim() ?? ''
      const password = args?.password ?? ''
      if (!login || !password) {
        return { ok: false, error: 'login and password required' }
      }
      const baseUrl = args?.authUrl?.trim() || DEFAULT_AUTH_URL
      return postLogin(baseUrl, login, password)
    }
  )
}
