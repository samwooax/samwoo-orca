// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import ProfileOnlineMembers from './ProfileOnlineMembers'

afterEach(cleanup)

describe('ProfileOnlineMembers', () => {
  it('shows mapped member names without requiring the tooltip', () => {
    const { container } = render(
      <TooltipProvider>
        <ProfileOnlineMembers
          onlineLogins={new Set(['peer', 'kim'])}
          memberNames={
            new Map([
              ['kim', '김동훈'],
              ['peer', '동료']
            ])
          }
        />
      </TooltipProvider>
    )

    expect(container.textContent).toContain('김동훈')
    expect(container.textContent).toContain('동료')
  })

  it('falls back to the login when a display name is unavailable', () => {
    render(
      <TooltipProvider>
        <ProfileOnlineMembers onlineLogins={new Set(['unknown'])} memberNames={new Map()} />
      </TooltipProvider>
    )

    expect(screen.getByText(/unknown/)).toBeTruthy()
  })
})
