import { describe, expect, it } from 'vitest'
import type { TeamChatProgressEvent } from '../../../../shared/hermes-team-chat-progress'
import { finishTeamChatProgress, upsertTeamChatProgress } from './use-hermes-team-chat-progress'

function event(overrides: Partial<TeamChatProgressEvent> = {}): TeamChatProgressEvent {
  return {
    requestId: 'request-1',
    id: 'tool-1',
    kind: 'tool',
    title: 'Read',
    status: 'in_progress',
    ...overrides
  }
}

describe('Hermes team chat progress state', () => {
  it('updates an existing activity instead of duplicating it', () => {
    const current = [event()]
    expect(upsertTeamChatProgress(current, event({ status: 'completed' }))).toEqual([
      event({ status: 'completed' })
    ])
  })

  it('finishes only active activities', () => {
    const current = [event(), event({ id: 'tool-2', status: 'completed' })]
    expect(finishTeamChatProgress(current, 'failed')).toEqual([
      event({ status: 'failed' }),
      event({ id: 'tool-2', status: 'completed' })
    ])
  })
})
