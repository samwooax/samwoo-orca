import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import {
  acpConciseDetail,
  acpProgressStatus,
  acpTextContent,
  isAcpRecord,
  type AcpJsonRecord
} from './hermes-team-chat-acp-values'

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
      this.reply += acpTextContent(update.content)
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
      update.entries.forEach((entry, index) => {
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
    const detail = acpTextContent(update.content).replaceAll(/\s+/g, ' ').trim()
    if (!detail) {
      return
    }
    if (!this.activeThoughtId) {
      this.thoughtIndex += 1
      this.activeThoughtId = `thought-${this.thoughtIndex}`
    }
    this.activeThoughtText = this.activeThoughtText ? `${this.activeThoughtText} ${detail}` : detail
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
    const summary = {
      title: typeof update.title === 'string' ? update.title : '도구 실행',
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
    if (!id) {
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
