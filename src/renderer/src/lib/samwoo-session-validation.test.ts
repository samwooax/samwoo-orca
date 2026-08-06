import { describe, expect, it } from 'vitest'
import {
  hasValidSamwooSession,
  isSamwooSessionError,
  isValidSamwooToken
} from './samwoo-session-validation'

describe('SAMWOO session validation', () => {
  it('rejects an update-era stored login that has no workspace session token', () => {
    expect(
      hasValidSamwooSession({
        login: 'owner',
        name: 'Owner',
        role: 'ai_center',
        label: 'AI Center'
      })
    ).toBe(false)
  })

  it('accepts a complete persisted login session', () => {
    expect(
      hasValidSamwooSession({
        login: 'owner',
        name: 'Owner',
        role: 'ai_center',
        label: 'AI Center',
        token: 'session-token-long-enough'
      })
    ).toBe(true)
  })

  it('rejects malformed session tokens returned by login', () => {
    expect(isValidSamwooToken('too-short')).toBe(false)
    expect(isValidSamwooToken('session-token-long-enough')).toBe(true)
  })

  it.each(['login required', 'missing bearer token', 'invalid or expired session'])(
    'classifies %s as a session error',
    (error) => expect(isSamwooSessionError(error)).toBe(true)
  )

  it('does not treat a Nextcloud outage as an expired login', () => {
    expect(isSamwooSessionError('Nextcloud unavailable')).toBe(false)
  })
})
