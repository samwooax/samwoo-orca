import { redactString } from '../observability/redactor'
import { stripTerminalControl } from '../../shared/terminal-control-stripping'

const MAX_OUTPUT_BYTES = 64 * 1024

function resolveOutputLimit(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), MAX_OUTPUT_BYTES)
    : MAX_OUTPUT_BYTES
}

export class HermesAcpTerminalOutputBuffer {
  private readonly limit: number
  private content = Buffer.alloc(0)
  private truncated = false

  constructor(requestedLimit: unknown) {
    this.limit = resolveOutputLimit(requestedLimit)
  }

  append(chunk: Buffer): void {
    if (this.limit === 0) {
      this.truncated ||= chunk.length > 0
      return
    }
    const combined = Buffer.concat([this.content, chunk])
    if (combined.length <= this.limit) {
      this.content = combined
      return
    }
    let start = combined.length - this.limit
    while (start < combined.length && (combined[start] & 0xc0) === 0x80) {
      start += 1
    }
    this.content = combined.subarray(start)
    this.truncated = true
  }

  snapshot(): { output: string; truncated: boolean } {
    return {
      output: redactString(stripTerminalControl(this.content.toString('utf8'))),
      truncated: this.truncated
    }
  }
}
