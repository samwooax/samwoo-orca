// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HermesTeamChatModelControls } from './HermesTeamChatModelControls'

afterEach(cleanup)

describe('HermesTeamChatModelControls', () => {
  it('enables the GPT effort control', () => {
    render(
      <HermesTeamChatModelControls
        model="gpt-5.6-sol"
        effort="medium"
        disabled={false}
        onModelChange={vi.fn()}
        onEffortChange={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeEnabled()
    expect(screen.getByText('Medium')).toBeVisible()
  })

  it('enables effort selection for models that support it', () => {
    render(
      <HermesTeamChatModelControls
        model="fable"
        effort="high"
        disabled={false}
        onModelChange={vi.fn()}
        onEffortChange={vi.fn()}
      />
    )

    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeEnabled()
    expect(screen.getByText('High')).toBeVisible()
  })
})
