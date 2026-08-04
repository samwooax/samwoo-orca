import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HermesTeamChatRoute } from './hermes-team-chat-route'
import { hermesTeamChatStorageKey } from './hermes-team-chat-storage-key'
import { readStoredTeamChat } from './hermes-team-chat-stored-session'

const route: HermesTeamChatRoute = {
  profile: 'ai_center',
  host: 'qn6c',
  label: 'AI Center',
  cwd: '/workspace',
  mailToken: ''
}

describe('readStoredTeamChat', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null
    })
    vi.stubGlobal('crypto', { randomUUID: () => 'new-conversation' })
  })

  it('restores the model, effort, history, and persistent conversation id', () => {
    values.set(
      hermesTeamChatStorageKey(route, 'tab-1'),
      JSON.stringify({
        messages: [{ role: 'user', content: '계속해줘' }],
        model: 'fable',
        effort: 'high',
        conversationId: 'conversation-1'
      })
    )

    expect(readStoredTeamChat(route, 'tab-1')).toEqual({
      messages: [{ role: 'user', content: '계속해줘' }],
      model: 'fable',
      effort: 'high',
      conversationId: 'conversation-1'
    })
  })

  it('uses safe defaults for missing or invalid persisted state', () => {
    values.set(hermesTeamChatStorageKey(route, 'tab-1'), '{invalid')

    expect(readStoredTeamChat(route, 'tab-1')).toEqual({
      messages: [],
      model: 'gpt-5.5',
      effort: 'medium',
      conversationId: 'new-conversation'
    })
  })
})
