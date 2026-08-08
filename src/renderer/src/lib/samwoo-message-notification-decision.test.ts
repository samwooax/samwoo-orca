import { describe, expect, it } from 'vitest'
import type { SamwooProfileMessageChannel } from '../../../shared/samwoo-profile-messaging'
import {
  decideSamwooMessageNotifications,
  type SamwooChannelSeenState
} from './samwoo-message-notification-decision'

function channel(overrides: Partial<SamwooProfileMessageChannel>): SamwooProfileMessageChannel {
  return {
    key: 'team',
    kind: 'team',
    shareId: null,
    label: 'Team chat',
    unreadCount: 1,
    lastMessageAt: 1_000,
    lastMessagePreview: 'hello',
    lastMessageAuthor: 'kim',
    ...overrides
  }
}

function decide(
  seen: SamwooChannelSeenState | null,
  channels: SamwooProfileMessageChannel[]
): ReturnType<typeof decideSamwooMessageNotifications> {
  return decideSamwooMessageNotifications({
    seen,
    channels,
    ownLogin: 'me',
    teamChannelLabel: '팀 채팅',
    aggregateTitle: '새 메시지',
    aggregateBody: (count) => `외 ${count}개 채널에 새 메시지`
  })
}

describe('decideSamwooMessageNotifications', () => {
  it('stays silent on the first poll but records seen state', () => {
    const result = decide(null, [channel({ lastMessageAt: 5_000 })])
    expect(result.notifications).toEqual([])
    expect(result.nextSeen.get('team')).toBe(5_000)
  })

  it('notifies when a channel advances past the seen timestamp', () => {
    const result = decide(new Map([['team', 1_000]]), [
      channel({ lastMessageAt: 2_000, lastMessagePreview: '회의 시작합니다' })
    ])
    expect(result.notifications).toEqual([
      { channelKey: 'team', title: '팀 채팅', body: 'kim: 회의 시작합니다' }
    ])
  })

  it('does not notify for own messages, read channels, or unchanged channels', () => {
    const seen: SamwooChannelSeenState = new Map([['team', 1_000]])
    expect(
      decide(seen, [channel({ lastMessageAt: 2_000, lastMessageAuthor: 'me' })]).notifications
    ).toEqual([])
    expect(decide(seen, [channel({ lastMessageAt: 2_000, unreadCount: 0 })]).notifications).toEqual(
      []
    )
    expect(decide(seen, [channel({ lastMessageAt: 1_000 })]).notifications).toEqual([])
  })

  it('uses the workspace label for workspace channels', () => {
    const result = decide(new Map([['workspace:a', 0]]), [
      channel({ key: 'workspace:a', kind: 'workspace', shareId: 'a', label: '설계 공유' })
    ])
    expect(result.notifications[0]?.title).toBe('설계 공유')
  })

  it('collapses a burst into an aggregate notification', () => {
    const seen: SamwooChannelSeenState = new Map()
    const channels = ['a', 'b', 'c', 'd', 'e'].map((key) =>
      channel({ key: `workspace:${key}`, kind: 'workspace', shareId: key, label: key })
    )
    const result = decide(seen, channels)
    expect(result.notifications).toHaveLength(3)
    expect(result.notifications.at(-1)).toEqual({
      channelKey: 'samwoo-aggregate',
      title: '새 메시지',
      body: '외 3개 채널에 새 메시지'
    })
  })

  it('drops channels that disappear from the next seen state', () => {
    const result = decide(new Map([['workspace:gone', 9_000]]), [channel({})])
    expect(result.nextSeen.has('workspace:gone')).toBe(false)
  })
})
