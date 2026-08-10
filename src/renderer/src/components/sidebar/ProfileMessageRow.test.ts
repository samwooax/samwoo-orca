import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'
import ProfileMessageRow, { mergeProfileMessages } from './ProfileMessageRow'

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

  it('shows online presence only on the avatar, not again between name and time', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProfileMessageRow, {
        message: message('online', 1),
        startsGroup: true,
        online: true,
        memberNames: new Map([['peer', '동료']]),
        onReply: () => {},
        onRetry: () => {}
      })
    )

    expect(markup.match(/bg-status-success/g)).toHaveLength(1)
  })

  it('shows the unread member count on an authored message', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProfileMessageRow, {
        message: { ...message('mine', 1), authorLogin: 'me', isAuthor: true, unreadCount: 2 },
        startsGroup: true,
        online: false,
        memberNames: new Map(),
        onReply: () => {},
        onRetry: () => {}
      })
    )

    expect(markup).toContain('2 people have not read this message')
    expect(markup).toContain('>2</span>')
  })
})
