import { request } from 'node:http'
import type { SamwooWorkspaceShareResult } from '../../shared/samwoo-workspace-sharing'

const AUTH_URL = 'http://100.116.18.119:8823'
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024

export function postSamwooWorkspaceShare(
  route: string,
  token: string,
  body: Record<string, unknown> = {},
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<SamwooWorkspaceShareResult> {
  return new Promise((resolve) => {
    const url = new URL(route, AUTH_URL)
    const payload = JSON.stringify(body)
    const req = request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 60_000
      },
      (response) => {
        let responseBody = ''
        let responseBytes = 0
        response.on('data', (chunk: Buffer) => {
          responseBytes += chunk.length
          if (responseBytes <= maxResponseBytes) {
            responseBody += chunk.toString('utf8')
          }
        })
        response.on('end', () => {
          if (responseBytes > maxResponseBytes) {
            resolve({ ok: false, error: 'workspace share response is too large' })
            return
          }
          try {
            resolve(JSON.parse(responseBody) as SamwooWorkspaceShareResult)
          } catch {
            resolve({ ok: false, error: `bad response (${response.statusCode})` })
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: 'workspace share server timed out' })
    })
    req.on('error', (error) => resolve({ ok: false, error: error.message }))
    req.end(payload)
  })
}
