import { describe, expect, it, vi } from 'vitest'
import { createTeamChatComposerOptions } from './hermes-team-chat-composer-options'

describe('createTeamChatComposerOptions', () => {
  it('exposes compact model and effort options to the composer actions', async () => {
    const onModelChange = vi.fn()
    const onEffortChange = vi.fn()
    const options = createTeamChatComposerOptions({
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
      onModelChange,
      onEffortChange
    })

    expect(options.snapshot.map((option) => option.id)).toEqual(['effort', 'model'])
    await options.surface.setOption('effort', 'high')
    await options.surface.setOption('model', 'gpt-5.6-luna')

    expect(onEffortChange).toHaveBeenCalledWith('high')
    expect(onModelChange).toHaveBeenCalledWith('gpt-5.6-luna')
  })
})
