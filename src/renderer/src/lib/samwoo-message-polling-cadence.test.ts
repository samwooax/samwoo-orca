import { describe, expect, it } from 'vitest'
import { samwooMessagePollingCadence } from './samwoo-message-polling-cadence'

describe('SAMWOO message polling cadence', () => {
  it('degrades polling only while SSE is connected and restores fallback immediately', () => {
    expect(samwooMessagePollingCadence('connected')).toEqual({
      openForegroundMs: 60_000,
      openBackgroundMs: 300_000,
      inboxMs: 300_000
    })
    expect(samwooMessagePollingCadence('disconnected')).toEqual({
      openForegroundMs: 3_000,
      openBackgroundMs: 30_000,
      inboxMs: 30_000
    })
    expect(samwooMessagePollingCadence('expired').inboxMs).toBe(30_000)
  })
})
