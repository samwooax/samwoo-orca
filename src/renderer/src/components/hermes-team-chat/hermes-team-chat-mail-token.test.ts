import { describe, expect, it } from 'vitest'
import { resolveHermesTeamChatMailToken } from './hermes-team-chat-mail-token'

describe('resolveHermesTeamChatMailToken', () => {
  it('uses the newly signed-in mail session for an already-open chat', () => {
    expect(resolveHermesTeamChatMailToken('new-token', 'expired-token')).toBe('new-token')
  })

  it('keeps the route token for legacy sessions without a current token', () => {
    expect(resolveHermesTeamChatMailToken(undefined, 'route-token')).toBe('route-token')
  })
})
