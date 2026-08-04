import type { HermesAcpSession } from './hermes-team-chat-acp-client'

const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000

export type TeamChatSessionHandle = {
  client: HermesAcpSession
  created: boolean
  release: () => void
  invalidate: () => Promise<void>
}

type SessionRecord = {
  conversationId: string
  configurationKey: string
  client: HermesAcpSession
  activeRequestId: string | null
  idleTimer: ReturnType<typeof setTimeout> | null
  dispose: () => Promise<void>
}

export class HermesTeamChatSessionRegistry {
  private readonly records = new Map<string, SessionRecord>()

  async acquire(args: {
    conversationId: string
    configurationKey: string
    requestId: string
    create: () => { client: HermesAcpSession; dispose: () => Promise<void> }
  }): Promise<TeamChatSessionHandle> {
    let record = this.records.get(args.conversationId)
    let created = false
    if (record && (record.configurationKey !== args.configurationKey || record.client.isClosed)) {
      await this.remove(record)
      record = undefined
    }
    if (!record) {
      const session = args.create()
      record = {
        conversationId: args.conversationId,
        configurationKey: args.configurationKey,
        client: session.client,
        activeRequestId: null,
        idleTimer: null,
        dispose: session.dispose
      }
      this.records.set(args.conversationId, record)
      created = true
    }
    if (record.activeRequestId) {
      throw new Error('Hermes conversation is already processing a request')
    }
    if (record.idleTimer) {
      clearTimeout(record.idleTimer)
      record.idleTimer = null
    }
    record.activeRequestId = args.requestId
    const selected = record
    return {
      client: selected.client,
      created,
      release: () => this.release(selected, args.requestId),
      invalidate: () => this.remove(selected)
    }
  }

  async close(conversationId: string): Promise<boolean> {
    const record = this.records.get(conversationId)
    if (!record) {
      return false
    }
    await this.remove(record)
    return true
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.records.values()].map((record) => this.remove(record)))
  }

  private release(record: SessionRecord, requestId: string): void {
    if (
      this.records.get(record.conversationId) !== record ||
      record.activeRequestId !== requestId
    ) {
      return
    }
    record.activeRequestId = null
    record.idleTimer = setTimeout(() => {
      void this.remove(record)
    }, SESSION_IDLE_TIMEOUT_MS)
    record.idleTimer.unref?.()
  }

  private async remove(record: SessionRecord): Promise<void> {
    if (this.records.get(record.conversationId) !== record) {
      return
    }
    this.records.delete(record.conversationId)
    if (record.idleTimer) {
      clearTimeout(record.idleTimer)
    }
    record.client.close()
    await record.dispose().catch(() => {})
  }
}
