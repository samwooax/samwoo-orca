import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { TeamChatEffort, TeamChatModelId } from './hermes-team-chat-models'
import { acpErrorMessage, isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'
import { HermesAcpTurnProgress } from './hermes-team-chat-acp-turn-progress'
import {
  createHermesAcpCapabilityProbeLogger,
  type HermesAcpCapabilityProbe,
  type HermesAcpCapabilityProbeLogger
} from './hermes-team-chat-acp-capability-probe'
import { HermesAcpFilesystemRequestDispatcher } from './hermes-team-chat-acp-filesystem-dispatch'
import { HermesAcpJsonlReader } from './hermes-team-chat-acp-jsonl-reader'
import { HermesAcpInboundTurn } from './hermes-team-chat-acp-inbound-turn'
import {
  classifyHermesAcpMessage,
  type HermesAcpMessageKind
} from './hermes-team-chat-acp-message-shape'
import { routeHermesAcpAgentMessage } from './hermes-team-chat-acp-agent-message-routing'
import type { HermesAcpSessionOptions } from './hermes-team-chat-acp-session-options'
import type { HermesAcpLocalFilesCapability } from './hermes-team-chat-acp-local-files-capability'
import { HermesAcpTerminalRequestDispatcher } from './hermes-team-chat-acp-terminal-dispatch'

export type TeamChatResult = { ok: boolean; reply?: string; error?: string }

type PendingRequest = {
  method: string
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

export class HermesAcpSession {
  private stderr = ''
  private sessionId = ''
  private requestSequence = 0
  private currentModel: TeamChatModelId | null = null
  private currentEffort: TeamChatEffort | null = null
  private activeTurn: HermesAcpTurnProgress | null = null
  private cancelRequested = false
  private closedError: Error | null = null
  private readonly inboundTurn = new HermesAcpInboundTurn()
  private readonly pending = new Map<number, PendingRequest>()
  private readonly ready: Promise<void>
  private readonly capabilityProbe: HermesAcpCapabilityProbe | null
  private readonly localFilesCapability: HermesAcpLocalFilesCapability | null
  private readonly filesystemRequests: HermesAcpFilesystemRequestDispatcher | null
  private readonly terminalRequests: HermesAcpTerminalRequestDispatcher | null
  private readonly stdoutReader: HermesAcpJsonlReader
  private readonly logMessage: HermesAcpCapabilityProbeLogger

  constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly profile: string,
    mailToken = '',
    options: HermesAcpSessionOptions = {}
  ) {
    this.capabilityProbe = profile === 'ai_center' ? (options.capabilityProbe ?? null) : null
    const localFiles = profile === 'ai_center' ? (options.localFiles ?? null) : null
    this.localFilesCapability = localFiles?.capability ?? null
    this.filesystemRequests = localFiles
      ? new HermesAcpFilesystemRequestDispatcher(localFiles.filesystem)
      : null
    this.terminalRequests =
      localFiles?.capability.localTerminal && localFiles.terminal
        ? new HermesAcpTerminalRequestDispatcher(localFiles.terminal)
        : null
    this.stdoutReader = new HermesAcpJsonlReader(
      (message, frameBytes) => this.receiveMessage(message, frameBytes),
      () => this.failProtocol('Hermes ACP frame exceeded the local size limit')
    )
    this.logMessage = createHermesAcpCapabilityProbeLogger({
      probe: this.capabilityProbe,
      profile,
      log: options.log ?? ((line) => console.info(line))
    })
    this.proc.stdout.on('data', (data: Buffer) => this.stdoutReader.push(data))
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
    void this.ready.catch(() => {})
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
      this.beginPromptMessages()
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
      this.endPromptMessages()
      this.activeTurn = null
      this.cancelRequested = false
    }
  }

  cancel(): boolean {
    if (!this.sessionId || !this.activeTurn || this.isClosed) {
      return false
    }
    this.cancelRequested = true
    this.cancelPromptMessages()
    this.writeMessage({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: this.sessionId }
    })
    return true
  }

  close(): Promise<void> {
    if (!this.isClosed) {
      this.handleClose(new Error('Hermes ACP session closed'))
      this.proc.stdin.end()
    }
    return this.terminalRequests?.close() ?? Promise.resolve()
  }

  private async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities:
        this.localFilesCapability?.clientCapabilities ??
        this.capabilityProbe?.clientCapabilities ??
        {},
      clientInfo: { name: 'samwoo-orca', title: 'SAMWOO-ORCA', version: '1' }
    })
    const result = await this.request('session/new', {
      cwd: this.capabilityProbe?.sessionCwd ?? `/opt/data/profiles/${this.profile}`,
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
      this.pending.set(id, { method, resolve, reject })
      this.writeMessage({ jsonrpc: '2.0', id, method, params })
    })
  }

  private receiveMessage(message: AcpJsonRecord, frameBytes: number): void {
    const kind = classifyHermesAcpMessage(message)
    if (!kind) {
      return
    }
    if (!this.inboundTurn.accept(frameBytes)) {
      this.failProtocol('Hermes ACP prompt exceeded the local inbound limit')
      return
    }
    const responseTo =
      kind !== 'response' || typeof message.id !== 'number'
        ? undefined
        : this.pending.get(message.id)?.method
    this.logMessage('agent_to_client', message, responseTo)
    try {
      this.handleMessage(message, kind)
    } catch {
      this.failProtocol('Hermes ACP returned an invalid local message')
    }
  }

  private handleMessage(message: AcpJsonRecord, kind: HermesAcpMessageKind): void {
    if (kind !== 'response') {
      routeHermesAcpAgentMessage({
        message,
        kind,
        capabilityProbe: this.capabilityProbe,
        filesystemRequests: this.filesystemRequests,
        terminalRequests: this.terminalRequests,
        sessionId: this.sessionId,
        activeTurn: this.activeTurn,
        acceptingPromptMessages: this.inboundTurn.active,
        cancelRequested: this.cancelRequested,
        writeMessage: (response, responseTo) => this.writeMessage(response, responseTo)
      })
      return
    }
    if (typeof message.id !== 'number') {
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) {
      return
    }
    if (pending.method === 'session/prompt') {
      this.endPromptMessages()
    }
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(acpErrorMessage(message.error)))
    } else {
      pending.resolve(message.result)
    }
  }

  private beginPromptMessages(): void {
    this.inboundTurn.begin()
    this.filesystemRequests?.beginTurn()
    this.terminalRequests?.beginTurn()
  }

  private endPromptMessages(): void {
    if (!this.inboundTurn.active) {
      return
    }
    this.inboundTurn.end()
    this.filesystemRequests?.endTurn()
    this.terminalRequests?.endTurn()
  }

  private cancelPromptMessages(): void {
    this.inboundTurn.end()
    this.filesystemRequests?.cancelTurn()
    this.terminalRequests?.cancelTurn()
  }

  private failProtocol(message: string): void {
    if (this.isClosed) {
      return
    }
    this.handleClose(new Error(message))
    this.proc.kill()
  }

  private writeMessage(message: AcpJsonRecord, responseTo?: string): void {
    if (this.isClosed) {
      return
    }
    this.logMessage('client_to_agent', message, responseTo)
    this.proc.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleClose(error: Error): void {
    if (this.closedError) {
      return
    }
    this.closedError = error
    this.stdoutReader.stop()
    this.cancelPromptMessages()
    void this.terminalRequests?.close()
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
