import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'

const GROUP_WINDOW_MS = 5 * 60_000

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function getProfileMessageGrouping(
  previous: SamwooProfileMessage | undefined,
  current: SamwooProfileMessage
): { startsGroup: boolean; startsDate: boolean } {
  if (!previous) {
    return { startsGroup: true, startsDate: true }
  }
  const startsDate = localDateKey(previous.createdAt) !== localDateKey(current.createdAt)
  return {
    startsDate,
    startsGroup:
      startsDate ||
      previous.authorLogin !== current.authorLogin ||
      current.createdAt - previous.createdAt > GROUP_WINDOW_MS
  }
}

export function formatProfileMessageDate(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const key = localDateKey(timestamp)
  if (key === localDateKey(today.getTime())) {
    return 'today'
  }
  if (key === localDateKey(yesterday.getTime())) {
    return 'yesterday'
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date)
}
