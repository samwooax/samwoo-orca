import { describe, expect, it } from 'vitest'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'
import { normalizeSamwooEventMessage } from './use-profile-message-live-updates'

const eventMessage: SamwooProfileMessage = {
  id: 'message-1',
  channelKey: 'team',
  channelKind: 'team',
  authorLogin: 'lee',
  body: 'hello',
  createdAt: 1,
  isAuthor: true
}

describe('SAMWOO live message normalization', () => {
  it('ignores sender-relative isAuthor and recomputes it for the receiver', () => {
    expect(normalizeSamwooEventMessage(eventMessage, 'kim').isAuthor).toBe(false)
    expect(normalizeSamwooEventMessage(eventMessage, 'lee').isAuthor).toBe(true)
    expect(normalizeSamwooEventMessage(eventMessage, 'LEE@Company.Test').isAuthor).toBe(true)
  })
})
