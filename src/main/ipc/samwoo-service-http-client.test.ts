import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isSupportedSamwooServiceProtocol,
  postSamwooServiceJson
} from './samwoo-service-http-client'

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done())))
  )
})

function request(
  baseUrl: string,
  retryTransient = false
): Promise<{ ok: boolean; error?: string }> {
  return postSamwooServiceJson({
    baseUrl,
    route: '/test',
    body: {},
    timeoutMs: 1_000,
    timeoutError: 'timed out',
    invalidUrlError: 'invalid url',
    maxResponseBytes: 1_024,
    responseTooLargeError: 'response too large',
    retryTransient
  })
}

describe('SAMWOO service HTTP client', () => {
  it('accepts only explicit HTTP transports', () => {
    expect(isSupportedSamwooServiceProtocol('http:')).toBe(true)
    expect(isSupportedSamwooServiceProtocol('https:')).toBe(true)
    expect(isSupportedSamwooServiceProtocol('ftp:')).toBe(false)
  })

  it('rejects unsupported protocols instead of silently sending plain HTTP', async () => {
    await expect(request('ftp://example.test')).resolves.toEqual({
      ok: false,
      error: 'unsupported service protocol'
    })
  })

  it('retries a transient read failure once', async () => {
    let attempts = 0
    const server = createServer((incoming, response) => {
      incoming.resume()
      attempts += 1
      if (attempts === 1) {
        incoming.socket.destroy()
        return
      }
      response.setHeader('Content-Type', 'application/json')
      response.end('{"ok":true}')
    })
    servers.push(server)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind')
    }

    await expect(request(`http://127.0.0.1:${address.port}`, true)).resolves.toEqual({ ok: true })
    expect(attempts).toBe(2)
  })
})
