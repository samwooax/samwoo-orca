import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'

type TeamChatResult = { ok: boolean; reply?: string; error?: string }
type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toolDetail(input: unknown): string | undefined {
  if (!isRecord(input)) {
    return undefined
  }
  for (const key of ['path', 'file_path', 'command', 'query', 'pattern']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim().replaceAll(/\s+/g, ' ').slice(0, 240)
    }
  }
  return undefined
}

function resultError(message: JsonRecord): string {
  for (const key of ['error', 'result']) {
    const value = message[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return 'Claude 작업이 실패했습니다.'
}

export function runClaudeStreamProcess(args: {
  proc: ChildProcessWithoutNullStreams
  requestId: string
  message: string
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<TeamChatResult> {
  return new Promise((resolveResult) => {
    let buffer = ''
    let stderr = ''
    let assistantText = ''
    let settled = false
    const tools = new Map<string, string>()

    const emit = (event: Omit<TeamChatProgressEvent, 'requestId'>): void => {
      args.onProgress?.({ requestId: args.requestId, ...event })
    }
    const finish = (result: TeamChatResult): void => {
      if (!settled) {
        settled = true
        resolveResult(result)
      }
    }
    const handleAssistant = (message: JsonRecord): void => {
      const payload = isRecord(message.message) ? message.message : {}
      const content = Array.isArray(payload.content) ? payload.content : []
      for (const block of content) {
        if (!isRecord(block)) {
          continue
        }
        if (block.type === 'text' && typeof block.text === 'string') {
          assistantText += block.text
        }
        if (block.type === 'tool_use' && typeof block.id === 'string') {
          const title = typeof block.name === 'string' ? block.name : '도구 실행'
          tools.set(block.id, title)
          emit({
            id: block.id,
            kind: 'tool',
            title,
            ...(toolDetail(block.input) ? { detail: toolDetail(block.input) } : {}),
            status: 'in_progress'
          })
        }
      }
    }
    const handleToolResults = (message: JsonRecord): void => {
      const payload = isRecord(message.message) ? message.message : {}
      const content = Array.isArray(payload.content) ? payload.content : []
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'tool_result') {
          continue
        }
        const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
        if (id) {
          emit({
            id,
            kind: 'tool',
            title: tools.get(id) ?? '도구 실행',
            status: block.is_error === true ? 'failed' : 'completed'
          })
        }
      }
    }
    const handleMessage = (message: JsonRecord): void => {
      if (message.type === 'assistant') {
        handleAssistant(message)
        return
      }
      if (message.type === 'user') {
        handleToolResults(message)
        return
      }
      if (message.type !== 'result') {
        return
      }
      const failed = message.is_error === true || message.subtype !== 'success'
      emit({
        id: 'agent',
        kind: 'phase',
        title: '에이전트 작업',
        status: failed ? 'failed' : 'completed'
      })
      const reply =
        typeof message.result === 'string' ? message.result.trim() : assistantText.trim()
      finish(
        failed
          ? { ok: false, error: resultError(message) }
          : reply
            ? { ok: true, reply }
            : { ok: false, error: 'Claude가 빈 응답을 반환했습니다.' }
      )
    }

    emit({
      id: 'agent',
      kind: 'phase',
      title: '에이전트 작업',
      status: 'in_progress'
    })
    args.proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const message = JSON.parse(line) as unknown
          if (isRecord(message)) {
            handleMessage(message)
          }
        } catch {
          // Why: Claude owns stdout, but one malformed diagnostic line should not discard the turn.
        }
      }
    })
    args.proc.stderr.on('data', (data: Buffer) => {
      stderr = `${stderr}${data.toString()}`.slice(-4000)
    })
    args.proc.on('error', (error) => finish({ ok: false, error: error.message }))
    args.proc.on('close', (code) => {
      if (!settled) {
        finish({
          ok: false,
          error: stderr.trim() || `Claude 작업이 응답 없이 종료되었습니다. (종료 코드 ${code})`
        })
      }
    })
    args.proc.stdin.write(args.message)
    args.proc.stdin.end()
  })
}
