import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import {
  acpConciseDetail,
  acpProgressStatus,
  acpTextContent,
  isAcpRecord,
  type AcpJsonRecord
} from './hermes-team-chat-acp-values'

const MAX_REPLY_BYTES = 4 * 1024 * 1024
const MAX_THOUGHT_CHARS = 4_096
const MAX_TOOL_SUMMARIES = 512
const MAX_TOOL_ID_CHARS = 256
const MAX_PLAN_ENTRIES = 256

export class HermesAcpTurnProgress {
  reply = ''
  private thoughtIndex = 0
  private activeThoughtId: string | null = null
  private activeThoughtText = ''
  private readonly toolSummaries = new Map<string, { title: string; detail?: string }>()

  constructor(
    private readonly requestId: string,
    private readonly onProgress?: (event: TeamChatProgressEvent) => void
  ) {}

  emit(event: Omit<TeamChatProgressEvent, 'requestId'>): void {
    this.onProgress?.({ requestId: this.requestId, ...event })
  }

  handleUpdate(update: AcpJsonRecord): void {
    if (update.sessionUpdate === 'agent_message_chunk') {
      const chunk = acpTextContent(update.content)
      if (Buffer.byteLength(this.reply) + Buffer.byteLength(chunk) > MAX_REPLY_BYTES) {
        throw new Error('ACP reply exceeded the local size limit')
      }
      this.reply += chunk
      return
    }
    if (update.sessionUpdate === 'agent_thought_chunk') {
      this.handleThought(update)
      return
    }
    if (update.sessionUpdate === 'tool_call') {
      this.handleToolCall(update)
      return
    }
    if (update.sessionUpdate === 'tool_call_update') {
      this.handleToolUpdate(update)
      return
    }
    if (update.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
      update.entries.slice(0, MAX_PLAN_ENTRIES).forEach((entry, index) => {
        if (isAcpRecord(entry) && typeof entry.content === 'string') {
          this.emit({
            id: `plan-${index}`,
            kind: 'plan',
            title: entry.content.slice(0, 240),
            status: acpProgressStatus(entry.status)
          })
        }
      })
    }
  }

  completeThought(): void {
    if (!this.activeThoughtId) {
      return
    }
    this.emit({
      id: this.activeThoughtId,
      kind: 'thought',
      title: '분석',
      ...(this.activeThoughtText ? { detail: this.activeThoughtText.slice(0, 240) } : {}),
      status: 'completed'
    })
    this.activeThoughtId = null
    this.activeThoughtText = ''
  }

  private handleThought(update: AcpJsonRecord): void {
    const detail = acpTextContent(update.content)
      .slice(0, MAX_THOUGHT_CHARS)
      .replaceAll(/\s+/g, ' ')
      .trim()
    if (!detail) {
      return
    }
    if (!this.activeThoughtId) {
      this.thoughtIndex += 1
      this.activeThoughtId = `thought-${this.thoughtIndex}`
    }
    this.activeThoughtText = (
      this.activeThoughtText ? `${this.activeThoughtText} ${detail}` : detail
    ).slice(0, MAX_THOUGHT_CHARS)
    this.emit({
      id: this.activeThoughtId,
      kind: 'thought',
      title: '분석',
      detail: this.activeThoughtText.slice(0, 240),
      status: 'in_progress'
    })
  }

  private handleToolCall(update: AcpJsonRecord): void {
    this.completeThought()
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : `tool-${Date.now()}`
    if (id.length > MAX_TOOL_ID_CHARS) {
      throw new Error('ACP tool id exceeded the local size limit')
    }
    if (!this.toolSummaries.has(id) && this.toolSummaries.size >= MAX_TOOL_SUMMARIES) {
      throw new Error('ACP tool count exceeded the local limit')
    }
    const summary = {
      title: typeof update.title === 'string' ? update.title.slice(0, 240) : '도구 실행',
      detail: acpConciseDetail(update)
    }
    this.toolSummaries.set(id, summary)
    this.emit({
      id,
      kind: 'tool',
      title: summary.title,
      ...(summary.detail ? { detail: summary.detail } : {}),
      status: acpProgressStatus(update.status)
    })
  }

  private handleToolUpdate(update: AcpJsonRecord): void {
    const id = typeof update.toolCallId === 'string' ? update.toolCallId : ''
    if (!id || id.length > MAX_TOOL_ID_CHARS) {
      return
    }
    const summary = this.toolSummaries.get(id)
    this.emit({
      id,
      kind: 'tool',
      title: summary?.title ?? '도구 실행',
      ...(summary?.detail ? { detail: summary.detail } : {}),
      status: acpProgressStatus(update.status)
    })
  }
}
