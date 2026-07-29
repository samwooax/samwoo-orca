import { describe, expect, it } from 'vitest'
import { parseHermesTeamChatRoute } from './hermes-team-chat-route'

describe('parseHermesTeamChatRoute', () => {
  it('recognizes the loopback team-chat route', () => {
    expect(
      parseHermesTeamChatRoute(
        'http://127.0.0.1:47821/chat?profile=hr&label=%EC%B4%9D%EB%AC%B4%EC%9D%B8%EC%82%AC&host=hermes%40100.68.242.83&cwd=C%3A%5Cwork'
      )
    ).toEqual({
      profile: 'hr',
      label: '총무인사',
      host: 'hermes@100.68.242.83',
      cwd: 'C:\\work',
      mailToken: ''
    })
  })

  it('rejects ordinary browser pages and unsafe route values', () => {
    expect(parseHermesTeamChatRoute('https://example.com/chat?profile=hr')).toBeNull()
    expect(
      parseHermesTeamChatRoute(
        'http://127.0.0.1:47821/chat?profile=hr%20bad&host=hermes%40100.68.242.83'
      )
    ).toBeNull()
  })
})
