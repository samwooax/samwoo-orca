import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { ipcMain } from 'electron'
import { SAMWOO_AUTH_URL } from './samwoo-workspace-share-client'

export type SamwooConnectionHealth = {
  ok: boolean
  latencyMs?: number
  error?: string
}

const PROBE_TIMEOUT_MS = 4_000

export function probeSamwooAuthServer(baseUrl: string): Promise<SamwooConnectionHealth> {
  return new Promise((resolvePromise) => {
    let url: URL
    try {
      url = new URL('/', baseUrl)
    } catch {
      resolvePromise({ ok: false, error: 'invalid auth server url' })
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      resolvePromise({ ok: false, error: 'unsupported auth server protocol' })
      return
    }
    const startedAt = Date.now()
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: PROBE_TIMEOUT_MS
      },
      (response) => {
        // Why: any HTTP status proves the auth service is reachable.
        response.resume()
        resolvePromise({ ok: true, latencyMs: Date.now() - startedAt })
      }
    )
    req.on('timeout', () => req.destroy(new Error('auth server timed out')))
    req.on('error', (error) => resolvePromise({ ok: false, error: error.message }))
    req.end()
  })
}

export function registerSamwooConnectionHealthHandlers(): void {
  ipcMain.handle(
    'samwoo:connectionHealth',
    (): Promise<SamwooConnectionHealth> => probeSamwooAuthServer(SAMWOO_AUTH_URL)
  )
}
