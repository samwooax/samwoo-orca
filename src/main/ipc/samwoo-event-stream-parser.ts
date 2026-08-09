import { StringDecoder } from 'node:string_decoder'
import type { SamwooProfileEvent } from '../../shared/samwoo-profile-messaging'

const MAX_EVENT_BYTES = 256 * 1024

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function admitSamwooProfileEvent(value: unknown): SamwooProfileEvent | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const event = value as Record<string, unknown>
  if (event.type === 'expired') {
    return { type: 'expired' }
  }
  if ((event.type === 'snapshot' || event.type === 'presence') && isStringArray(event.online)) {
    return { type: event.type, online: event.online }
  }
  if (
    event.type === 'read' &&
    typeof event.channelKey === 'string' &&
    typeof event.login === 'string'
  ) {
    return { type: 'read', channelKey: event.channelKey, login: event.login }
  }
  if (
    event.type === 'workspace-assignees' &&
    typeof event.shareId === 'string' &&
    typeof event.displayName === 'string' &&
    isStringArray(event.addedLogins) &&
    typeof event.updatedBy === 'string' &&
    typeof event.updatedAt === 'number'
  ) {
    return event as SamwooProfileEvent
  }
  if (
    event.type === 'message' &&
    typeof event.channelKey === 'string' &&
    event.message &&
    typeof event.message === 'object'
  ) {
    const message = event.message as Record<string, unknown>
    if (
      typeof message.id === 'string' &&
      typeof message.channelKey === 'string' &&
      (message.channelKind === 'team' || message.channelKind === 'workspace') &&
      typeof message.authorLogin === 'string' &&
      typeof message.body === 'string' &&
      typeof message.createdAt === 'number'
    ) {
      return event as SamwooProfileEvent
    }
  }
  return null
}

export class SamwooEventStreamParser {
  private readonly decoder = new StringDecoder('utf8')
  private buffered = ''
  private dataLines: string[] = []
  private eventBytes = 0

  constructor(private readonly onEvent: (event: SamwooProfileEvent) => void) {}

  push(chunk: Buffer): void {
    this.buffered += this.decoder.write(chunk)
    this.consumeLines(false)
  }

  end(): void {
    this.buffered += this.decoder.end()
    this.consumeLines(true)
    this.flushEvent()
  }

  private consumeLines(flushRemainder: boolean): void {
    let newline = this.buffered.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffered.slice(0, newline).replace(/\r$/, '')
      this.buffered = this.buffered.slice(newline + 1)
      this.consumeLine(line)
      newline = this.buffered.indexOf('\n')
    }
    if (flushRemainder && this.buffered) {
      this.consumeLine(this.buffered.replace(/\r$/, ''))
      this.buffered = ''
    }
    if (Buffer.byteLength(this.buffered, 'utf8') > MAX_EVENT_BYTES) {
      this.resetEvent()
      this.buffered = ''
    }
  }

  private consumeLine(line: string): void {
    if (!line) {
      this.flushEvent()
      return
    }
    if (line.startsWith(':') || !line.startsWith('data:')) {
      return
    }
    const data = line.slice(5).replace(/^ /, '')
    this.eventBytes += Buffer.byteLength(data, 'utf8')
    if (this.eventBytes > MAX_EVENT_BYTES) {
      this.resetEvent()
      return
    }
    this.dataLines.push(data)
  }

  private flushEvent(): void {
    if (!this.dataLines.length) {
      this.resetEvent()
      return
    }
    try {
      const event = admitSamwooProfileEvent(JSON.parse(this.dataLines.join('\n')))
      if (event) {
        this.onEvent(event)
      }
    } catch {
      // A malformed server event must not terminate the long-lived stream.
    }
    this.resetEvent()
  }

  private resetEvent(): void {
    this.dataLines = []
    this.eventBytes = 0
  }
}
