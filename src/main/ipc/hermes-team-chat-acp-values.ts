import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'

export type AcpJsonRecord = Record<string, unknown>

export function isAcpRecord(value: unknown): value is AcpJsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function acpTextContent(value: unknown): string {
  if (isAcpRecord(value) && value.type === 'text' && typeof value.text === 'string') {
    return value.text
  }
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map((item) => (isAcpRecord(item) ? acpTextContent(item.content) : ''))
    .filter(Boolean)
    .join('\n')
}

export function acpConciseDetail(update: AcpJsonRecord): string | undefined {
  if (Array.isArray(update.locations)) {
    const paths = update.locations
      .map((location) =>
        isAcpRecord(location) && typeof location.path === 'string' ? location.path : ''
      )
      .filter(Boolean)
    if (paths.length) {
      return paths.slice(0, 4).join(', ')
    }
  }
  if (isAcpRecord(update.rawInput)) {
    for (const key of ['path', 'file_path', 'command', 'query', 'pattern']) {
      const value = update.rawInput[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim().slice(0, 240)
      }
    }
  }
  const content = acpTextContent(update.content).replaceAll(/\s+/g, ' ').trim()
  return content ? content.slice(0, 240) : undefined
}

export function acpErrorMessage(value: unknown): string {
  if (isAcpRecord(value) && typeof value.message === 'string') {
    return value.message
  }
  return 'Hermes ACP request failed'
}

export function acpProgressStatus(value: unknown): TeamChatProgressEvent['status'] {
  if (value === 'completed') {
    return 'completed'
  }
  if (value === 'failed' || value === 'cancelled') {
    return 'failed'
  }
  return value === 'pending' ? 'pending' : 'in_progress'
}
