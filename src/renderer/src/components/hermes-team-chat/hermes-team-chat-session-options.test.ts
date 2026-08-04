import { describe, expect, it } from 'vitest'
import { createTeamChatOptionSnapshot } from './hermes-team-chat-session-options'

describe('createTeamChatOptionSnapshot', () => {
  it('offers the configured Hermes models in the chat composer', () => {
    const snapshot = createTeamChatOptionSnapshot('gpt-5.6-sol', 'medium')
    const model = snapshot.find((option) => option.id === 'model')

    expect(model?.kind).toMatchObject({
      type: 'select',
      currentValue: 'gpt-5.6-sol',
      choices: expect.arrayContaining([
        { value: 'fable', label: 'Fable 5' },
        { value: 'opus', label: 'Opus 4.8' },
        { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
        { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
        { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
        { value: 'gpt-5.5', label: 'GPT-5.5' }
      ])
    })
  })

  it('offers effort values when the selected provider supports them', () => {
    const snapshot = createTeamChatOptionSnapshot('fable', 'high')
    const effort = snapshot.find((option) => option.id === 'effort')

    expect(effort?.kind).toEqual({
      type: 'select',
      currentValue: 'high',
      choices: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Extra high' },
        { value: 'max', label: 'Max' }
      ]
    })
  })

  it('does not claim an effort control for Hermes ACP models', () => {
    const snapshot = createTeamChatOptionSnapshot('gpt-5.5', 'medium')

    expect(snapshot.find((option) => option.id === 'effort')).toBeUndefined()
  })
})
