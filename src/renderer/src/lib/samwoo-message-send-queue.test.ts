import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SamwooProfileMessage,
  SendSamwooProfileMessageArgs
} from '../../../shared/samwoo-profile-messaging'
import { SamwooMessageSendQueue } from './samwoo-message-send-queue'

const args: SendSamwooProfileMessageArgs = {
  token: 'message-token-0123456789',
  channelKind: 'team',
  body: 'hello',
  clientMessageId: 'client-message-0001'
}

const pending: SamwooProfileMessage = {
  id: 'pending:client-message-0001',
  channelKey: 'team',
  channelKind: 'team',
  authorLogin: 'kim',
  body: 'hello',
  createdAt: 1,
  isAuthor: true,
  clientMessageId: args.clientMessageId,
  deliveryState: 'pending'
}

const confirmed: SamwooProfileMessage = {
  ...pending,
  id: 'server-message-1',
  deliveryState: undefined,
  clientMessageId: undefined
}

afterEach(() => vi.useRealTimers())

describe('SAMWOO message send queue', () => {
  it('shows pending immediately and replaces it with the confirmed message', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, message: confirmed })
    const queue = new SamwooMessageSendQueue(send)
    const events: unknown[] = []
    queue.subscribe((event) => events.push(event))

    queue.enqueue(args, pending)
    expect(queue.pendingMessages('team')).toHaveLength(1)
    await vi.waitFor(() => expect(queue.pendingMessages('team')).toHaveLength(0))

    expect(send).toHaveBeenCalledWith(args)
    expect(events).toContainEqual({
      type: 'confirmed',
      channelKey: 'team',
      temporaryId: pending.id,
      message: confirmed
    })
  })

  it('retries three times with one stable client id, then supports manual resend', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    const queue = new SamwooMessageSendQueue(send)

    queue.enqueue(args, pending)
    await vi.runAllTimersAsync()

    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.every(([call]) => call.clientMessageId === args.clientMessageId)).toBe(
      true
    )
    expect(queue.pendingMessages('team')[0]?.deliveryState).toBe('failed')

    send.mockResolvedValueOnce({ ok: true, message: confirmed })
    queue.retry(args.clientMessageId)
    await vi.runAllTimersAsync()
    expect(queue.pendingMessages('team')).toHaveLength(0)
  })

  it('does not retry an expired session and drops jobs from another account', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValue({ ok: false, error: 'invalid or expired session' })
    const queue = new SamwooMessageSendQueue(send)
    const events: unknown[] = []
    queue.subscribe((event) => events.push(event))

    queue.enqueue(args, pending)
    await vi.runAllTimersAsync()

    expect(send).toHaveBeenCalledOnce()
    expect(events).toContainEqual({ type: 'session-expired', error: 'invalid or expired session' })

    queue.enqueue(args, pending)
    queue.retainToken('different-token-0123456789')
    expect(queue.pendingMessages('team')).toHaveLength(0)
  })
})
