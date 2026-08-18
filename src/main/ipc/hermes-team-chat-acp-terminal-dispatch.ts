import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'
import { isHermesAcpRequestId } from './hermes-team-chat-acp-message-shape'
import type { HermesAcpTerminal } from './hermes-team-chat-acp-terminal'

const MAX_REQUESTS_PER_TURN = 64
const MAX_CONCURRENT_REQUESTS = 8
const MAX_RECENT_RESPONSES = 128
const TERMINAL_CREATE_DEADLINE_MS = 45_000

type InFlightTerminalRequest = {
  abort: AbortController
  response: Promise<AcpJsonRecord>
}

function requestKey(generation: number, id: string | number): string {
  return `${generation}:${typeof id}:${id}`
}

function errorResponse(id: string | number, code: number, message: string): AcpJsonRecord {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function publicTerminalError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^(?:ACP terminal|local terminal command)/.test(message)
    ? message
    : 'local terminal request failed'
}

export class HermesAcpTerminalRequestDispatcher {
  private activeTurn = false
  private generation = 0
  private requestCount = 0
  private readonly inFlight = new Map<string, InFlightTerminalRequest>()
  private readonly recent = new Map<string, AcpJsonRecord>()

  constructor(private readonly terminal: HermesAcpTerminal) {}

  beginTurn(): void {
    this.generation += 1
    this.activeTurn = true
    this.requestCount = 0
    this.abortInFlight()
    this.recent.clear()
  }

  endTurn(): void {
    const endingGeneration = this.generation
    if (this.activeTurn) {
      this.generation += 1
    }
    this.activeTurn = false
    this.abortInFlight()
    this.recent.clear()
    this.terminal.endGeneration(endingGeneration)
  }

  cancelTurn(): void {
    const cancelledGeneration = this.generation
    if (this.activeTurn) {
      this.generation += 1
    }
    this.activeTurn = false
    this.abortInFlight()
    this.recent.clear()
    this.terminal.cancelGeneration(cancelledGeneration)
  }

  close(): Promise<void> {
    this.cancelTurn()
    return this.terminal.close()
  }

  cancelRequest(id: string | number): void {
    this.inFlight.get(requestKey(this.generation, id))?.abort.abort()
  }

  isSupportedMethod(method: unknown): method is string {
    return this.terminal.isSupportedMethod(method)
  }

  dispatch(message: AcpJsonRecord, sessionId: string): Promise<AcpJsonRecord> {
    const id = message.id
    if (!isHermesAcpRequestId(id)) {
      return Promise.resolve(errorResponse('', -32_600, 'ACP terminal request id is required'))
    }
    const generation = this.generation
    const key = requestKey(generation, id)
    const completed = this.recent.get(key)
    if (completed) {
      return Promise.resolve(completed)
    }
    const pending = this.inFlight.get(key)
    if (pending) {
      return pending.response
    }
    if (this.inFlight.size >= MAX_CONCURRENT_REQUESTS) {
      return Promise.resolve(errorResponse(id, -32_000, 'too many ACP terminal requests'))
    }
    const abort = new AbortController()
    const deadline =
      message.method === 'terminal/create'
        ? setTimeout(() => abort.abort(), TERMINAL_CREATE_DEADLINE_MS)
        : null
    deadline?.unref?.()
    const response = this.execute(message, sessionId, id, generation, abort.signal)
      .then((result) => {
        if (this.activeTurn && generation === this.generation) {
          this.recent.set(key, result)
          this.pruneRecentResponses()
        }
        return result
      })
      .finally(() => {
        if (deadline) {
          clearTimeout(deadline)
        }
        this.inFlight.delete(key)
      })
    this.inFlight.set(key, { abort, response })
    return response
  }

  private async execute(
    message: AcpJsonRecord,
    sessionId: string,
    id: string | number,
    generation: number,
    signal: AbortSignal
  ): Promise<AcpJsonRecord> {
    const method = message.method
    if (!this.isSupportedMethod(method)) {
      return errorResponse(id, -32_601, 'ACP terminal method is not supported')
    }
    if (!this.activeTurn) {
      return errorResponse(id, -32_800, 'ACP prompt is not active')
    }
    const params = isAcpRecord(message.params) ? message.params : null
    if (!sessionId || !params || params.sessionId !== sessionId) {
      return errorResponse(id, -32_602, 'ACP terminal session does not match')
    }
    this.requestCount += 1
    if (this.requestCount > MAX_REQUESTS_PER_TURN) {
      return errorResponse(id, -32_000, 'ACP terminal request limit reached')
    }
    const canContinue = () => this.activeTurn && generation === this.generation && !signal.aborted
    try {
      const result = await this.terminal.handle(method, params, generation, canContinue, signal)
      return canContinue()
        ? { jsonrpc: '2.0', id, result }
        : errorResponse(id, -32_800, 'ACP terminal request was cancelled')
    } catch (error) {
      return errorResponse(
        id,
        canContinue() ? -32_000 : -32_800,
        canContinue() ? publicTerminalError(error) : 'ACP terminal request was cancelled'
      )
    }
  }

  private abortInFlight(): void {
    for (const request of this.inFlight.values()) {
      request.abort.abort()
    }
    this.inFlight.clear()
  }

  private pruneRecentResponses(): void {
    while (this.recent.size > MAX_RECENT_RESPONSES) {
      const oldest = this.recent.keys().next().value
      if (oldest === undefined) {
        return
      }
      this.recent.delete(oldest)
    }
  }
}
