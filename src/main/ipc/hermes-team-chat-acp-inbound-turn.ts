const MAX_TURN_INBOUND_BYTES = 16 * 1024 * 1024
const MAX_TURN_INBOUND_MESSAGES = 2_048

export class HermesAcpInboundTurn {
  active = false
  private bytes = 0
  private messages = 0

  begin(): void {
    this.active = true
    this.bytes = 0
    this.messages = 0
  }

  end(): void {
    this.active = false
  }

  accept(frameBytes: number): boolean {
    if (!this.active) {
      return true
    }
    this.bytes += frameBytes
    this.messages += 1
    return this.bytes <= MAX_TURN_INBOUND_BYTES && this.messages <= MAX_TURN_INBOUND_MESSAGES
  }
}
