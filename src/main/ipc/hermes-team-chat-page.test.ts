import { describe, expect, it } from 'vitest'
import { getHermesTeamChatPage } from './hermes-team-chat-page'

describe('Hermes team chat page', () => {
  it('renders every requested model and native-chat controls', () => {
    const html = getHermesTeamChatPage('test-token')
    expect(html).toContain('Fable 5')
    expect(html).toContain('Opus 4.8')
    expect(html).toContain('GPT-5.6 Sol')
    expect(html).toContain('GPT-5.5')
    expect(html).toContain('aria-label="텍스트 파일 첨부"')
    expect(html).toContain('aria-label="모델"')
    expect(html).toContain('<span class="picker-label">추론 수준</span>')
    expect(html).toContain('minimal: "Minimal"')
    expect(html).not.toContain('parentElement.hidden')
    expect(html).toContain('aria-label="보내기"')
  })

  it('emits valid standalone client JavaScript', () => {
    const html = getHermesTeamChatPage('test-token')
    const script = html.match(/<script>([\s\S]+)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    expect(() => new Function(script!)).not.toThrow()
  })
})
