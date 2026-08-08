import { Agent as HttpAgent, request as httpRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'

type SamwooServiceResult = { ok: boolean; error?: string }

type PostSamwooServiceJsonOptions = {
  baseUrl: string
  route: string
  body: Record<string, unknown>
  token?: string
  timeoutMs: number
  timeoutError: string
  invalidUrlError: string
  maxResponseBytes: number
  responseTooLargeError: string
  retryTransient?: boolean
}

const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 16 })
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 16 })
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN'
])
const RETRY_DELAY_MS = 250

export function isSupportedSamwooServiceProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:'
}

function isTransientNetworkError(error: Error): boolean {
  return TRANSIENT_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? '')
}

export function postSamwooServiceJson<Result extends SamwooServiceResult>(
  options: PostSamwooServiceJsonOptions
): Promise<Result> {
  let url: URL
  try {
    url = new URL(options.route, options.baseUrl)
  } catch {
    return Promise.resolve({ ok: false, error: options.invalidUrlError } as Result)
  }
  if (!isSupportedSamwooServiceProtocol(url.protocol)) {
    return Promise.resolve({ ok: false, error: 'unsupported service protocol' } as Result)
  }

  const payload = JSON.stringify(options.body)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  const agent = url.protocol === 'https:' ? httpsAgent : httpAgent

  return new Promise((resolve) => {
    const attempt = (retriesRemaining: number): void => {
      let settled = false
      const req = request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          agent,
          headers: {
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: options.timeoutMs
        },
        (response) => {
          const chunks: Buffer[] = []
          let responseBytes = 0
          response.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            responseBytes += buffer.length
            if (responseBytes <= options.maxResponseBytes) {
              chunks.push(buffer)
            }
          })
          response.on('end', () => {
            if (settled) {
              return
            }
            settled = true
            if (responseBytes > options.maxResponseBytes) {
              resolve({ ok: false, error: options.responseTooLargeError } as Result)
              return
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Result)
            } catch {
              resolve({ ok: false, error: `bad response (${response.statusCode})` } as Result)
            }
          })
        }
      )

      req.on('timeout', () => {
        const error = Object.assign(new Error(options.timeoutError), { code: 'ETIMEDOUT' })
        req.destroy(error)
      })
      req.on('error', (error) => {
        if (settled) {
          return
        }
        settled = true
        if (retriesRemaining > 0 && isTransientNetworkError(error)) {
          setTimeout(() => attempt(retriesRemaining - 1), RETRY_DELAY_MS)
          return
        }
        resolve({ ok: false, error: error.message } as Result)
      })
      req.end(payload)
    }

    attempt(options.retryTransient ? 1 : 0)
  })
}
