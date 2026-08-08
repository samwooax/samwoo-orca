import type { SamwooProfileMessageChannel } from '../../../shared/samwoo-profile-messaging'

export type SamwooMessageNotification = {
  channelKey: string
  title: string
  body: string
}

export type SamwooChannelSeenState = Map<string, number>

const MAX_NOTIFICATIONS_PER_POLL = 3
const BODY_MAX_CHARS = 160

export function decideSamwooMessageNotifications(args: {
  seen: SamwooChannelSeenState | null
  channels: SamwooProfileMessageChannel[]
  ownLogin: string
  teamChannelLabel: string
  aggregateTitle: string
  aggregateBody: (hiddenChannelCount: number) => string
}): { notifications: SamwooMessageNotification[]; nextSeen: SamwooChannelSeenState } {
  const nextSeen: SamwooChannelSeenState = new Map()
  const fresh: SamwooMessageNotification[] = []
  for (const channel of args.channels) {
    const lastAt = channel.lastMessageAt ?? 0
    nextSeen.set(channel.key, lastAt)
    // Why: the first poll after launch or login must not replay old messages.
    if (!args.seen) {
      continue
    }
    const seenAt = args.seen.get(channel.key) ?? 0
    if (
      lastAt <= seenAt ||
      channel.unreadCount <= 0 ||
      channel.lastMessageAuthor === args.ownLogin
    ) {
      continue
    }
    fresh.push({
      channelKey: channel.key,
      title: channel.kind === 'team' ? args.teamChannelLabel : channel.label,
      body: `${channel.lastMessageAuthor ?? ''}: ${channel.lastMessagePreview ?? ''}`.slice(
        0,
        BODY_MAX_CHARS
      )
    })
  }
  if (fresh.length <= MAX_NOTIFICATIONS_PER_POLL) {
    return { notifications: fresh, nextSeen }
  }
  // Why: reconnect bursts must not spam the OS notification tray.
  const shown = fresh.slice(0, MAX_NOTIFICATIONS_PER_POLL - 1)
  shown.push({
    channelKey: 'samwoo-aggregate',
    title: args.aggregateTitle,
    body: args.aggregateBody(fresh.length - (MAX_NOTIFICATIONS_PER_POLL - 1))
  })
  return { notifications: shown, nextSeen }
}
