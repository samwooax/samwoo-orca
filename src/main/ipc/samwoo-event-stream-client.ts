import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import type {
  SamwooEventStreamState,
  SamwooEventStreamStatus,
  SamwooProfileEvent
} from '../../shared/samwoo-profile-messaging'
import { SamwooEventStreamParser } from './samwoo-event-stream-parser'

const CONNECT_TIMEOUT_MS = 15_000
const MAX_RECONNECT_MS = 60_000

export function samwooEventStreamReconnectDelay(attempt: number, random = Math.random): number {
  const base = Math.min(MAX_RECONNECT_MS, 1_000 * 2 ** Math.max(0, attempt))
  return Math.round(base * (0.85 + random() * 0.3))
}

type Options = {
  baseUrl: string
  emitEvent: (event: SamwooProfileEvent) => void
  emitStatus: (status: SamwooEventStreamStatus) => void
  random?: () => number
  request?: SamwooEventStreamRequest
}

export type SamwooEventStreamRequest = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest

export class SamwooEventStreamClient {
  private token: string | null = null
  private request: ClientRequest | null = null
  private response: IncomingMessage | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private generation = 0
  private status: SamwooEventStreamStatus = 'disconnected'
  private onlineLogins: string[] = []

  constructor(private readonly options: Options) {}

  start(token: string): void {
    if (this.token === token && (this.request || this.response || this.reconnectTimer)) {
      return
    }
    this.stop(false)
    this.token = token
    this.connect()
  }

  state(): SamwooEventStreamState {
    return { status: this.status, onlineLogins: [...this.onlineLogins] }
  }

  stop(emitDisconnected = true): void {
    this.generation += 1
    this.token = null
    this.reconnectAttempt = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.response?.destroy()
    this.response = null
    this.request?.destroy()
    this.request = null
    this.setStatus('disconnected', emitDisconnected)
  }

  private connect(): void {
    const token = this.token
    if (!token) {
      return
    }
    const generation = ++this.generation
    let url: URL
    try {
      url = new URL('/events', this.options.baseUrl)
    } catch {
      this.handleDisconnect(generation)
      return
    }
    const request = this.options.request ?? (url.protocol === 'https:' ? httpsRequest : httpRequest)
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`
        }
      },
      (response) => this.handleResponse(generation, response)
    )
    this.request = req
    req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(new Error('event stream timed out')))
    req.on('error', () => this.handleDisconnect(generation))
    req.end()
  }

  private handleResponse(generation: number, response: IncomingMessage): void {
    if (generation !== this.generation || !this.token) {
      response.destroy()
      return
    }
    this.request?.setTimeout(0)
    this.request = null
    if (response.statusCode === 401) {
      response.resume()
      this.expire()
      return
    }
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase()
    if (response.statusCode !== 200 || !contentType.startsWith('text/event-stream')) {
      response.resume()
      this.handleDisconnect(generation)
      return
    }
    this.response = response
    this.reconnectAttempt = 0
    this.setStatus('connected')
    const parser = new SamwooEventStreamParser((event) => {
      if (event.type === 'expired') {
        this.expire()
        return
      }
      if (event.type === 'snapshot' || event.type === 'presence') {
        this.onlineLogins = [...event.online]
      }
      this.options.emitEvent(event)
    })
    response.on('data', (chunk: Buffer | string) =>
      parser.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    )
    response.on('end', () => {
      parser.end()
      this.handleDisconnect(generation)
    })
    response.on('close', () => this.handleDisconnect(generation))
    response.on('error', () => this.handleDisconnect(generation))
  }

  private expire(): void {
    this.stop(false)
    this.setStatus('expired')
  }

  private handleDisconnect(generation: number): void {
    if (generation !== this.generation || !this.token) {
      return
    }
    this.generation += 1
    this.response?.destroy()
    this.response = null
    this.request?.destroy()
    this.request = null
    this.setStatus('disconnected')
    if (this.reconnectTimer) {
      return
    }
    const delay = samwooEventStreamReconnectDelay(
      this.reconnectAttempt,
      this.options.random ?? Math.random
    )
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
    this.reconnectTimer.unref?.()
  }

  private setStatus(status: SamwooEventStreamStatus, emit = true): void {
    this.status = status
    if (status !== 'connected') {
      this.onlineLogins = []
    }
    if (emit) {
      this.options.emitStatus(status)
    }
  }
}
