import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  SamwooEventStreamClient,
  type SamwooEventStreamRequest,
  samwooEventStreamReconnectDelay
} from './samwoo-event-stream-client'

type FakeResponse = IncomingMessage & EventEmitter

function response(statusCode: number, contentType = 'application/json'): FakeResponse {
  return Object.assign(new EventEmitter(), {
    statusCode,
    headers: { 'content-type': contentType },
    resume: vi.fn(),
    destroy: vi.fn()
  }) as unknown as FakeResponse
}

function requestReturning(
  fakeResponse: FakeResponse,
  afterResponse?: (response: FakeResponse) => void
): SamwooEventStreamRequest {
  return (_options, callback) => {
    const request = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: () =>
        queueMicrotask(() => {
          callback(fakeResponse)
          afterResponse?.(fakeResponse)
        })
    })
    return request as unknown as ClientRequest
  }
}

describe('SAMWOO event stream client', () => {
  it('falls back to disconnected state when the server has no SSE route', async () => {
    const statuses: string[] = []
    let resolveDisconnected: (() => void) | undefined
    const disconnected = new Promise<void>((resolve) => {
      resolveDisconnected = resolve
    })
    const client = new SamwooEventStreamClient({
      baseUrl: 'http://samwoo.test:8823',
      emitEvent: vi.fn(),
      emitStatus: (status) => {
        statuses.push(status)
        if (status === 'disconnected') {
          resolveDisconnected?.()
        }
      },
      random: () => 0.5,
      request: requestReturning(response(404))
    })

    client.start('event-stream-token-0123456789')
    await disconnected
    client.stop(false)

    expect(statuses).toEqual(['disconnected'])
    expect(client.state()).toEqual({ status: 'disconnected', onlineLogins: [] })
  })

  it('receives snapshots and expires without reconnecting', async () => {
    const events: unknown[] = []
    const statuses: string[] = []
    let resolveExpired: (() => void) | undefined
    const expired = new Promise<void>((resolve) => {
      resolveExpired = resolve
    })
    const fakeResponse = response(200, 'text/event-stream')
    const client = new SamwooEventStreamClient({
      baseUrl: 'http://samwoo.test:8823',
      emitEvent: (event) => events.push(event),
      emitStatus: (status) => {
        statuses.push(status)
        if (status === 'expired') {
          resolveExpired?.()
        }
      },
      request: requestReturning(fakeResponse, (stream) => {
        stream.emit('data', 'data: {"type":"snapshot","online":["kim","lee"]}\n\n')
        stream.emit('data', 'data: {"type":"expired"}\n\n')
      })
    })

    client.start('event-stream-token-0123456789')
    await expired

    expect(events).toEqual([{ type: 'snapshot', online: ['kim', 'lee'] }])
    expect(statuses).toEqual(['connected', 'expired'])
    expect(client.state()).toEqual({ status: 'expired', onlineLogins: [] })
  })

  it('treats an HTTP 401 handshake as session expiration', async () => {
    let resolveExpired: (() => void) | undefined
    const expired = new Promise<void>((resolve) => {
      resolveExpired = resolve
    })
    const statuses: string[] = []
    const client = new SamwooEventStreamClient({
      baseUrl: 'http://samwoo.test:8823',
      emitEvent: vi.fn(),
      emitStatus: (status) => {
        statuses.push(status)
        if (status === 'expired') {
          resolveExpired?.()
        }
      },
      request: requestReturning(response(401))
    })

    client.start('event-stream-token-0123456789')
    await expired

    expect(statuses).toEqual(['expired'])
  })

  it('caps exponential reconnect delay while preserving jitter bounds', () => {
    expect(samwooEventStreamReconnectDelay(0, () => 0)).toBe(850)
    expect(samwooEventStreamReconnectDelay(20, () => 1)).toBe(69_000)
  })
})
