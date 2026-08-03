import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { TeamChatModelId } from './hermes-team-chat-models'
import {
  acpConciseDetail,
  acpErrorMessage,
  acpProgressStatus,
  acpTextContent,
  isAcpRecord,
  type AcpJsonRecord
} from './hermes-team-chat-acp-values'

type TeamChatResult = { ok: boolean; reply?: string; error?: string }

export function runHermesAcpProcess(args: {
  proc: ChildProcessWithoutNullStreams
  requestId: string
  profile: string
  modelId: TeamChatModelId
  message: string
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<TeamChatResult> {
  return new Promise((resolveResult) => {
    let buffer = ''
    let stderr = ''
    let sessionId = ''
    let reply = ''
    let settled = false
    let thoughtIndex = 0
    let activeThoughtId: string | null = null
    let activeThoughtText = ''
    const toolSummaries = new Map<string, { title: string; detail?: string }>()

    const emit = (event: Omit<TeamChatProgressEvent, 'requestId'>): void => {
      args.onProgress?.({ requestId: args.requestId, ...event })
    }
    const finish = (result: TeamChatResult): void => {
      if (settled) {
        return
      }
      settled = true
      args.proc.stdin.end()
      resolveResult(result)
    }
    const send = (id: number, method: string, params: AcpJsonRecord): void => {
      args.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    }
    const completeThought = (): void => {
      if (!activeThoughtId) {
        return
      }
      emit({
        id: activeThoughtId,
        kind: 'thought',
        title: '분석',
        ...(activeThoughtText ? { detail: activeThoughtText.slice(0, 240) } : {}),
        status: 'completed'
      })
      activeThoughtId = null
      activeThoughtText = ''
    }

    const handleUpdate = (update: AcpJsonRecord): void => {
      if (update.sessionUpdate === 'agent_message_chunk') {
        reply += acpTextContent(update.content)
        return
      }
      if (update.sessionUpdate === 'agent_thought_chunk') {
        const detail = acpTextContent(update.content).replaceAll(/\s+/g, ' ').trim()
        if (!detail) {
          return
        }
        if (!activeThoughtId) {
          thoughtIndex += 1
          activeThoughtId = `thought-${thoughtIndex}`
        }
        activeThoughtText = activeThoughtText ? `${activeThoughtText} ${detail}` : detail
        emit({
          id: activeThoughtId,
          kind: 'thought',
          title: '분석',
          detail: activeThoughtText.slice(0, 240),
          status: 'in_progress'
        })
        return
      }
      if (update.sessionUpdate === 'tool_call') {
        completeThought()
        const toolCallId =
          typeof update.toolCallId === 'string' ? update.toolCallId : `tool-${Date.now()}`
        const summary = {
          title: typeof update.title === 'string' ? update.title : '도구 실행',
          detail: acpConciseDetail(update)
        }
        toolSummaries.set(toolCallId, summary)
        emit({
          id: toolCallId,
          kind: 'tool',
          title: summary.title,
          ...(summary.detail ? { detail: summary.detail } : {}),
          status: acpProgressStatus(update.status)
        })
        return
      }
      if (update.sessionUpdate === 'tool_call_update') {
        const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : ''
        if (toolCallId) {
          const summary = toolSummaries.get(toolCallId)
          emit({
            id: toolCallId,
            kind: 'tool',
            title: summary?.title ?? '도구 실행',
            ...(summary?.detail ? { detail: summary.detail } : {}),
            status: acpProgressStatus(update.status)
          })
        }
        return
      }
      if (update.sessionUpdate === 'plan' && Array.isArray(update.entries)) {
        update.entries.forEach((entry, index) => {
          if (!isAcpRecord(entry) || typeof entry.content !== 'string') {
            return
          }
          emit({
            id: `plan-${index}`,
            kind: 'plan',
            title: entry.content.slice(0, 240),
            status: acpProgressStatus(entry.status)
          })
        })
      }
    }

    const respondToPermission = (message: AcpJsonRecord): void => {
      const params = isAcpRecord(message.params) ? message.params : {}
      const options = Array.isArray(params.options) ? params.options : []
      const selected = options.find(
        (option) =>
          isAcpRecord(option) &&
          typeof option.optionId === 'string' &&
          (option.kind === 'allow_once' || option.kind === 'allow_always')
      )
      const result = selected
        ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
        : { outcome: { outcome: 'cancelled' } }
      args.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
    }

    const handleMessage = (message: AcpJsonRecord): void => {
      if (message.method === 'session/update' && isAcpRecord(message.params)) {
        const update = message.params.update
        if (isAcpRecord(update)) {
          handleUpdate(update)
        }
        return
      }
      if (message.method === 'session/request_permission' && message.id !== undefined) {
        respondToPermission(message)
        return
      }
      if (message.error) {
        finish({ ok: false, error: acpErrorMessage(message.error) })
        return
      }
      if (message.id === 0) {
        send(1, 'session/new', {
          cwd: `/opt/data/profiles/${args.profile}`,
          mcpServers: []
        })
        return
      }
      if (message.id === 1 && isAcpRecord(message.result)) {
        sessionId = typeof message.result.sessionId === 'string' ? message.result.sessionId : ''
        if (!sessionId) {
          finish({
            ok: false,
            error: 'Hermes ACP did not return a session id'
          })
          return
        }
        send(2, 'session/set_model', {
          sessionId,
          modelId: `openai-codex:${args.modelId}`
        })
        return
      }
      if (message.id === 2) {
        send(3, 'session/set_mode', { sessionId, modeId: 'dont_ask' })
        return
      }
      if (message.id === 3) {
        emit({
          id: 'agent',
          kind: 'phase',
          title: '에이전트 작업',
          status: 'in_progress'
        })
        send(4, 'session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: args.message }]
        })
        return
      }
      if (message.id === 4) {
        completeThought()
        emit({
          id: 'agent',
          kind: 'phase',
          title: '에이전트 작업',
          status: 'completed'
        })
        finish(
          reply.trim()
            ? { ok: true, reply: reply.trim() }
            : { ok: false, error: 'Hermes ACP returned an empty response' }
        )
      }
    }

    args.proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const message = JSON.parse(line) as unknown
          if (isAcpRecord(message)) {
            handleMessage(message)
          }
        } catch {
          // Why: ACP owns stdout, but tolerate one malformed diagnostic line without losing the turn.
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
          error: stderr.trim() || `Hermes ACP exited with code ${code}`
        })
      }
    })

    emit({ id: 'agent', kind: 'phase', title: '에이전트 연결', status: 'in_progress' })
    send(0, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'samwoo-orca', title: 'SAMWOO-ORCA', version: '1' }
    })
  })
}
