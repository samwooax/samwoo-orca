import { describe, expect, it } from 'vitest'
import {
  resolveHermesTeamChatActivitySummary,
  shouldShowHermesTeamChatActivity
} from './HermesTeamChatActivity'

describe('HermesTeamChatActivity summary', () => {
  it('distinguishes a successful turn with failed attempts from a failed turn', () => {
    expect(
      resolveHermesTeamChatActivitySummary({
        busy: false,
        eventCount: 12,
        completedCount: 7,
        hadFailedProgress: true,
        outcome: 'completed'
      })
    ).toMatchObject({
      key: 'auto.components.HermesTeamChatActivity.completedWithFailures'
    })

    expect(
      resolveHermesTeamChatActivitySummary({
        busy: false,
        eventCount: 3,
        completedCount: 3,
        hadFailedProgress: false,
        outcome: 'failed'
      })
    ).toEqual({
      key: 'auto.components.HermesTeamChatActivity.overallFailed',
      fallback: 'Response failed'
    })
  })

  it('keeps cancellation and an unsettled outcome distinct from failure and completion', () => {
    expect(shouldShowHermesTeamChatActivity(0, 'cancelled')).toBe(true)
    expect(shouldShowHermesTeamChatActivity(0, 'failed')).toBe(true)
    expect(shouldShowHermesTeamChatActivity(0, 'completed')).toBe(false)
    expect(
      resolveHermesTeamChatActivitySummary({
        busy: false,
        eventCount: 2,
        completedCount: 1,
        hadFailedProgress: true,
        outcome: 'cancelled'
      })
    ).toEqual({
      key: 'auto.components.HermesTeamChatActivity.cancelled',
      fallback: 'Response stopped'
    })

    expect(
      resolveHermesTeamChatActivitySummary({
        busy: false,
        eventCount: 2,
        completedCount: 2,
        hadFailedProgress: false,
        outcome: null
      })
    ).toMatchObject({ key: 'auto.components.HermesTeamChatActivity.running', value0: 2 })
  })

  it('keeps running and clean completion counts unchanged', () => {
    expect(
      resolveHermesTeamChatActivitySummary({
        busy: true,
        eventCount: 4,
        completedCount: 2,
        hadFailedProgress: true,
        outcome: null
      })
    ).toMatchObject({ key: 'auto.components.HermesTeamChatActivity.running', value0: 4 })

    expect(
      resolveHermesTeamChatActivitySummary({
        busy: false,
        eventCount: 4,
        completedCount: 4,
        hadFailedProgress: false,
        outcome: 'completed'
      })
    ).toMatchObject({ key: 'auto.components.HermesTeamChatActivity.completed', value0: 4 })
  })
})
