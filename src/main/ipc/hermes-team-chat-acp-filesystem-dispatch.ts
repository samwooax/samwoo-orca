import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'
import type { HermesAcpFilesystem } from './hermes-team-chat-acp-filesystem'
import { isHermesAcpRequestId } from './hermes-team-chat-acp-message-shape'

const MAX_REQUESTS_PER_TURN = 64
const MAX_CONCURRENT_REQUESTS = 4
const MAX_READ_BYTES_PER_TURN = 4 * 1024 * 1024
const MAX_RECENT_RESPONSES = 128

type InFlightFilesystemRequest = {
  abort: AbortController
  response: Promise<AcpJsonRecord>
}

function requestKey(generation: number, id: string | number): string {
  return `${generation}:${typeof id}:${id}`
}

function errorResponse(id: string | number, code: number, message: string): AcpJsonRecord {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export class HermesAcpFilesystemRequestDispatcher {
  private activeTurn = false
  private generation = 0
  private requestCount = 0
  private readBytes = 0
  private readonly inFlight = new Map<string, InFlightFilesystemRequest>()
  private readonly recent = new Map<string, AcpJsonRecord>()

  constructor(private readonly filesystem: HermesAcpFilesystem) {}

  beginTurn(): void {
    this.generation += 1
    this.activeTurn = true
    this.requestCount = 0
    this.readBytes = 0
    this.abortInFlight()
    this.recent.clear()
    this.filesystem.resetReadRevisions()
  }

  endTurn(): void {
    if (this.activeTurn) {
      this.generation += 1
    }
    this.activeTurn = false
    this.abortInFlight()
    this.recent.clear()
    this.filesystem.cancelActivePreviews()
  }

  cancelTurn(): void {
    if (this.activeTurn) {
      this.generation += 1
    }
    this.activeTurn = false
    this.abortInFlight()
    this.recent.clear()
    this.filesystem.cancelActivePreviews()
  }

  cancelRequest(id: string | number): void {
    this.inFlight.get(requestKey(this.generation, id))?.abort.abort()
  }

  isSupportedMethod(method: unknown): method is string {
    return method === 'fs/read_text_file' || method === 'fs/write_text_file'
  }

  dispatch(message: AcpJsonRecord, sessionId: string): Promise<AcpJsonRecord> {
    const id = message.id
    if (!isHermesAcpRequestId(id)) {
      return Promise.resolve(errorResponse('', -32_600, 'ACP filesystem request id is required'))
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
      return Promise.resolve(errorResponse(id, -32_000, 'too many ACP filesystem requests'))
    }
    const abort = new AbortController()
    const task = this.execute(message, sessionId, id, generation, abort.signal)
      .then((response) => {
        if (this.activeTurn && generation === this.generation) {
          this.recent.set(key, response)
          while (this.recent.size > MAX_RECENT_RESPONSES) {
            const oldest = this.recent.keys().next().value
            if (oldest === undefined) {
              break
            }
            this.recent.delete(oldest)
          }
        }
        return response
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, { abort, response: task })
    return task
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
      return errorResponse(id, -32_601, 'ACP filesystem method is not supported')
    }
    if (!this.activeTurn) {
      return errorResponse(id, -32_800, 'ACP prompt is not active')
    }
    const params = isAcpRecord(message.params) ? message.params : null
    if (!sessionId || !params || params.sessionId !== sessionId) {
      return errorResponse(id, -32_602, 'ACP filesystem session does not match')
    }
    this.requestCount += 1
    if (this.requestCount > MAX_REQUESTS_PER_TURN) {
      return errorResponse(id, -32_000, 'ACP filesystem request limit reached')
    }
    const canCommit = () => this.activeTurn && generation === this.generation && !signal.aborted
    try {
      const result = await this.filesystem.handle(method, params, canCommit, signal)
      if (!canCommit()) {
        return errorResponse(id, -32_800, 'ACP prompt was cancelled')
      }
      if (method === 'fs/read_text_file' && isAcpRecord(result)) {
        this.readBytes += Buffer.byteLength(String(result.content ?? ''))
        if (this.readBytes > MAX_READ_BYTES_PER_TURN) {
          return errorResponse(id, -32_000, 'ACP filesystem read budget reached')
        }
      }
      return { jsonrpc: '2.0', id, result }
    } catch (error) {
      if (!canCommit()) {
        return errorResponse(id, -32_800, 'ACP prompt was cancelled')
      }
      return errorResponse(
        id,
        -32_000,
        error instanceof Error ? error.message : 'ACP filesystem request failed'
      )
    }
  }

  private abortInFlight(): void {
    for (const request of this.inFlight.values()) {
      request.abort.abort()
    }
    this.inFlight.clear()
  }
}
