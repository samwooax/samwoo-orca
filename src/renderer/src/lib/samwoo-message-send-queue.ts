import type {
  SamwooProfileMessage,
  SamwooProfileMessagingResult,
  SendSamwooProfileMessageArgs
} from '../../../shared/samwoo-profile-messaging'
import { isSamwooSessionError } from './samwoo-session-validation'

const MAX_ATTEMPTS = 3

type SendQueueJob = {
  args: SendSamwooProfileMessageArgs
  message: SamwooProfileMessage
  attempt: number
  timer: ReturnType<typeof setTimeout> | null
}

export type SamwooMessageSendQueueEvent =
  | { type: 'changed'; channelKey: string }
  | {
      type: 'confirmed'
      channelKey: string
      temporaryId: string
      message: SamwooProfileMessage
    }
  | { type: 'session-expired'; error: string }

type SendMessage = (args: SendSamwooProfileMessageArgs) => Promise<SamwooProfileMessagingResult>

export class SamwooMessageSendQueue {
  private readonly jobs = new Map<string, SendQueueJob>()
  private readonly listeners = new Set<(event: SamwooMessageSendQueueEvent) => void>()

  constructor(private readonly sendMessage: SendMessage) {}

  subscribe(listener: (event: SamwooMessageSendQueueEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueue(args: SendSamwooProfileMessageArgs, message: SamwooProfileMessage): void {
    const job: SendQueueJob = { args, message, attempt: 0, timer: null }
    this.jobs.set(args.clientMessageId, job)
    this.emit({ type: 'changed', channelKey: message.channelKey })
    void this.attempt(job)
  }

  retry(clientMessageId: string): void {
    const job = this.jobs.get(clientMessageId)
    if (!job || job.message.deliveryState !== 'failed') {
      return
    }
    job.attempt = 0
    job.message = { ...job.message, deliveryState: 'retrying' }
    this.emit({ type: 'changed', channelKey: job.message.channelKey })
    void this.attempt(job)
  }

  pendingMessages(channelKey: string): SamwooProfileMessage[] {
    return [...this.jobs.values()]
      .map((job) => job.message)
      .filter((message) => message.channelKey === channelKey)
  }

  retainToken(token: string | null): void {
    for (const [clientMessageId, job] of this.jobs) {
      if (!token || job.args.token !== token) {
        if (job.timer) {
          clearTimeout(job.timer)
        }
        this.jobs.delete(clientMessageId)
        this.emit({ type: 'changed', channelKey: job.message.channelKey })
      }
    }
  }

  private async attempt(job: SendQueueJob): Promise<void> {
    const clientMessageId = job.args.clientMessageId
    if (this.jobs.get(clientMessageId) !== job) {
      return
    }
    job.timer = null
    job.attempt += 1
    job.message = {
      ...job.message,
      deliveryState: job.attempt === 1 ? 'pending' : 'retrying'
    }
    this.emit({ type: 'changed', channelKey: job.message.channelKey })
    let result: SamwooProfileMessagingResult
    try {
      result = await this.sendMessage(job.args)
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : 'message send failed' }
    }
    if (this.jobs.get(clientMessageId) !== job) {
      return
    }
    if (result.ok && result.message) {
      this.jobs.delete(clientMessageId)
      this.emit({
        type: 'confirmed',
        channelKey: job.message.channelKey,
        temporaryId: job.message.id,
        message: result.message
      })
      this.emit({ type: 'changed', channelKey: job.message.channelKey })
      return
    }
    const error = result.error ?? 'message send failed'
    if (isSamwooSessionError(error)) {
      this.jobs.delete(clientMessageId)
      this.emit({ type: 'changed', channelKey: job.message.channelKey })
      this.emit({ type: 'session-expired', error })
      return
    }
    if (job.attempt < MAX_ATTEMPTS) {
      job.message = { ...job.message, deliveryState: 'retrying' }
      this.emit({ type: 'changed', channelKey: job.message.channelKey })
      job.timer = setTimeout(() => void this.attempt(job), 1_000 * 2 ** (job.attempt - 1))
      return
    }
    job.message = { ...job.message, deliveryState: 'failed' }
    this.emit({ type: 'changed', channelKey: job.message.channelKey })
  }

  private emit(event: SamwooMessageSendQueueEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export const samwooMessageSendQueue = new SamwooMessageSendQueue((args) =>
  window.api.preflight.samwooProfileMessages.sendMessage(args)
)
