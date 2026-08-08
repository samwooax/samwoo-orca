import { describe, expect, it } from 'vitest'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'
import { getProfileMessageGrouping } from './profile-message-grouping'

function message(overrides: Partial<SamwooProfileMessage> = {}): SamwooProfileMessage {
  return {
    id: 'message-1',
    channelKey: 'team',
    channelKind: 'team',
    authorLogin: 'kim',
    body: 'hello',
    createdAt: new Date(2026, 7, 8, 10, 0).getTime(),
    isAuthor: false,
    ...overrides
  }
}

describe('getProfileMessageGrouping', () => {
  it('starts both a date and author group for the first message', () => {
    expect(getProfileMessageGrouping(undefined, message())).toEqual({
      startsGroup: true,
      startsDate: true
    })
  })

  it('groups the same author inside five minutes', () => {
    const previous = message()
    const current = message({ id: 'message-2', createdAt: previous.createdAt + 5 * 60_000 })
    expect(getProfileMessageGrouping(previous, current)).toEqual({
      startsGroup: false,
      startsDate: false
    })
  })

  it('starts a group for a different author or a gap over five minutes', () => {
    const previous = message()
    expect(
      getProfileMessageGrouping(previous, message({ authorLogin: 'lee', id: 'message-2' }))
    ).toMatchObject({ startsGroup: true })
    expect(
      getProfileMessageGrouping(
        previous,
        message({ id: 'message-3', createdAt: previous.createdAt + 5 * 60_000 + 1 })
      )
    ).toMatchObject({ startsGroup: true })
  })

  it('starts a date and author group across local midnight', () => {
    const previous = message({ createdAt: new Date(2026, 7, 8, 23, 59).getTime() })
    const current = message({ id: 'message-2', createdAt: new Date(2026, 7, 9, 0, 1).getTime() })
    expect(getProfileMessageGrouping(previous, current)).toEqual({
      startsGroup: true,
      startsDate: true
    })
  })
})
