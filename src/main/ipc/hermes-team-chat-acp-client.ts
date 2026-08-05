import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { TeamChatEffort, TeamChatModelId } from './hermes-team-chat-models'
import { acpErrorMessage, isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'
import { HermesAcpTurnProgress } from './hermes-team-chat-acp-turn-progress'

export type TeamChatResult = { ok: boolean; reply?: string; error?: string }

type PendingRequest = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

export class HermesAcpSession {
  private buffer = ''
  private stderr = ''
  private sessionId = ''
  private requestSequence = 0
  private currentModel: TeamChatModelId | null = null
  private currentEffort: TeamChatEffort | null = null
  private activeTurn: HermesAcpTurnProgress | null = null
  private cancelRequested = false
  private closedError: Error | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private readonly ready: Promise<void>

  constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly profile: string,
    mailToken = ''
  ) {
    this.proc.stdout.on('data', (data: Buffer) => this.handleStdout(data))
    this.proc.stderr.on('data', (data: Buffer) => {
      this.stderr = `${this.stderr}${data.toString()}`.slice(-4000)
    })
    this.proc.stdin.on('error', (error) => this.handleClose(error))
    this.proc.on('error', (error) => this.handleClose(error))
    this.proc.on('close', (code) => {
      this.handleClose(new Error(this.stderr.trim() || `Hermes ACP exited with code ${code}`))
    })
    // Why: the remote bootstrap consumes this line before exec, keeping the token out of process arguments.
    this.proc.stdin.write(`${mailToken}\n`)
    this.ready = this.initialize()
  }

  get isClosed(): boolean {
    return this.closedError !== null
  }

  async prompt(args: {
    requestId: string
    modelId: TeamChatModelId
    effort: TeamChatEffort
    message: string
    onProgress?: (event: TeamChatProgressEvent) => void
  }): Promise<TeamChatResult> {
    if (this.activeTurn) {
      return { ok: false, error: 'Hermes ACP session is already processing a prompt' }
    }
    const turn = new HermesAcpTurnProgress(args.requestId, args.onProgress)
    this.activeTurn = turn
    this.cancelRequested = false
    try {
      turn.emit({
        id: 'agent',
        kind: 'phase',
        title: '에이전트 연결',
        status: 'in_progress'
      })
      await this.ready
      turn.emit({ id: 'agent', kind: 'phase', title: '에이전트 연결', status: 'completed' })
      if (this.currentModel !== args.modelId) {
        await this.request('session/set_model', {
          sessionId: this.sessionId,
          modelId: `openai-codex:${args.modelId}`
        })
        this.currentModel = args.modelId
        this.currentEffort = null
      }
      if (this.currentEffort !== args.effort) {
        await this.request('session/set_config_option', {
          sessionId: this.sessionId,
          configId: 'reasoning_effort',
          value: args.effort
        })
        this.currentEffort = args.effort
      }
      turn.emit({ id: 'agent', kind: 'phase', title: '에이전트 작업', status: 'in_progress' })
      const response = await this.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: args.message }]
      })
      turn.completeThought()
      turn.emit({ id: 'agent', kind: 'phase', title: '에이전트 작업', status: 'completed' })
      const stopReason = isAcpRecord(response) ? response.stopReason : undefined
      if (stopReason === 'cancelled') {
        return { ok: false, error: 'cancelled' }
      }
      return turn.reply.trim()
        ? { ok: true, reply: turn.reply.trim() }
        : { ok: false, error: 'Hermes ACP returned an empty response' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.activeTurn = null
      this.cancelRequested = false
    }
  }

  cancel(): boolean {
    if (!this.sessionId || !this.activeTurn || this.isClosed) {
      return false
    }
    this.cancelRequested = true
    this.notify('session/cancel', { sessionId: this.sessionId })
    return true
  }

  close(): void {
    if (this.isClosed) {
      return
    }
    this.proc.stdin.end()
  }

  private async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'samwoo-orca', title: 'SAMWOO-ORCA', version: '1' }
    })
    const result = await this.request('session/new', {
      cwd: `/opt/data/profiles/${this.profile}`,
      mcpServers: []
    })
    this.sessionId =
      isAcpRecord(result) && typeof result.sessionId === 'string' ? result.sessionId : ''
    if (!this.sessionId) {
      throw new Error('Hermes ACP did not return a session id')
    }
  }

  private request(method: string, params: AcpJsonRecord): Promise<unknown> {
    if (this.closedError) {
      return Promise.reject(this.closedError)
    }
    this.requestSequence += 1
    const id = this.requestSequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  private notify(method: string, params: AcpJsonRecord): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  private handleStdout(data: Buffer): void {
    this.buffer += data.toString()
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const message = JSON.parse(line) as unknown
        if (isAcpRecord(message)) {
          this.handleMessage(message)
        }
      } catch {
        // Why: ACP owns stdout, but tolerate one malformed diagnostic line without losing the session.
      }
    }
  }

  private handleMessage(message: AcpJsonRecord): void {
    if (message.method === 'session/update' && isAcpRecord(message.params)) {
      const update = message.params.update
      if (isAcpRecord(update) && this.activeTurn) {
        this.activeTurn.handleUpdate(update)
      }
      return
    }
    if (message.method === 'session/request_permission' && message.id !== undefined) {
      this.respondToPermission(message)
      return
    }
    if (typeof message.id !== 'number') {
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) {
      return
    }
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(acpErrorMessage(message.error)))
    } else {
      pending.resolve(message.result)
    }
  }

  private respondToPermission(message: AcpJsonRecord): void {
    const params = isAcpRecord(message.params) ? message.params : {}
    const options = Array.isArray(params.options) ? params.options : []
    const selected = this.cancelRequested
      ? undefined
      : options.find(
          (option) =>
            isAcpRecord(option) &&
            typeof option.optionId === 'string' &&
            (option.kind === 'allow_once' || option.kind === 'allow_always')
        )
    const result = selected
      ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
      : { outcome: { outcome: 'cancelled' } }
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
  }

  private handleClose(error: Error): void {
    if (this.closedError) {
      return
    }
    this.closedError = error
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
