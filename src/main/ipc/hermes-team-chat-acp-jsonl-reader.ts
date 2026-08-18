import { StringDecoder } from 'node:string_decoder'
import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'

const MAX_ACP_FRAME_BYTES = 8 * 1024 * 1024

export class HermesAcpJsonlReader {
  private buffer = ''
  private stopped = false
  private readonly decoder = new StringDecoder('utf8')

  constructor(
    private readonly onMessage: (message: AcpJsonRecord, frameBytes: number) => void,
    private readonly onOverflow: () => void
  ) {}

  push(data: Buffer): void {
    if (this.stopped) {
      return
    }
    this.buffer += this.decoder.write(data)
    if (Buffer.byteLength(this.buffer) > MAX_ACP_FRAME_BYTES && !this.buffer.includes('\n')) {
      this.overflow()
      return
    }
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const frameBytes = Buffer.byteLength(line)
      if (frameBytes > MAX_ACP_FRAME_BYTES) {
        this.overflow()
        return
      }
      try {
        const message = JSON.parse(line) as unknown
        if (isAcpRecord(message)) {
          this.onMessage(message, frameBytes)
          if (this.stopped) {
            return
          }
        }
      } catch {
        // Why: ACP owns stdout, but one malformed diagnostic line should not lose the session.
      }
    }
    if (Buffer.byteLength(this.buffer) > MAX_ACP_FRAME_BYTES) {
      this.overflow()
    }
  }

  stop(): void {
    this.stopped = true
    this.buffer = ''
  }

  private overflow(): void {
    this.stop()
    this.onOverflow()
  }
}
