import { describe, expect, it } from 'vitest'
import type { HermesTeamChatRoute } from './hermes-team-chat-route'
import { hermesTeamChatStorageKey } from './hermes-team-chat-storage-key'

const route: HermesTeamChatRoute = {
  profile: 'ai_center',
  label: 'AI 센터',
  host: 'hermes@100.68.242.83',
  cwd: 'C:\\project',
  mailToken: 'not-part-of-storage-key'
}

describe('hermesTeamChatStorageKey', () => {
  it('isolates conversation history by tab', () => {
    expect(hermesTeamChatStorageKey(route, 'tab-1')).not.toBe(
      hermesTeamChatStorageKey(route, 'tab-2')
    )
  })

  it('does not put the mail token in browser storage metadata', () => {
    expect(hermesTeamChatStorageKey(route, 'tab-1')).not.toContain(route.mailToken)
  })
})
