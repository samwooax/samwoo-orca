import { describe, expect, it } from 'vitest'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'
import { mergeProfileMessages } from './ProfileMessageRow'

function message(id: string, createdAt: number, body = id): SamwooProfileMessage {
  return {
    id,
    channelKey: 'team',
    channelKind: 'team',
    authorLogin: 'peer',
    body,
    createdAt,
    isAuthor: false
  }
}

describe('profile message merging', () => {
  it('preserves older pages, deduplicates polling results, and sorts stable ties', () => {
    expect(
      mergeProfileMessages(
        [message('b', 2), message('d', 3)],
        [message('a', 2), message('d', 3, 'updated'), message('early', 1)]
      )
    ).toEqual([message('early', 1), message('a', 2), message('b', 2), message('d', 3, 'updated')])
  })
})
