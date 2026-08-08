import type { SamwooEventStreamStatus } from '../../../shared/samwoo-profile-messaging'

export type SamwooMessagePollingCadence = {
  openForegroundMs: number
  openBackgroundMs: number
  inboxMs: number
}

const FALLBACK_CADENCE: SamwooMessagePollingCadence = {
  openForegroundMs: 3_000,
  openBackgroundMs: 30_000,
  inboxMs: 30_000
}

const SSE_CADENCE: SamwooMessagePollingCadence = {
  openForegroundMs: 60_000,
  openBackgroundMs: 5 * 60_000,
  inboxMs: 5 * 60_000
}

export function samwooMessagePollingCadence(
  status: SamwooEventStreamStatus
): SamwooMessagePollingCadence {
  return status === 'connected' ? SSE_CADENCE : FALLBACK_CADENCE
}
