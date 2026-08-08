// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import SamwooConnectionStatusDot from './SamwooConnectionStatusDot'

describe('SamwooConnectionStatusDot', () => {
  let root: Root
  let container: HTMLDivElement
  const health = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    health.mockResolvedValue({ ok: true, latencyMs: 12 })
    useSamwooAuthStore.setState({
      auth: { login: 'kim', name: 'Kim', role: 'ai_center', label: 'AI Center', token: 'token' }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { preflight: { samwooConnectionHealth: health } }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    useSamwooAuthStore.setState({ auth: null })
    vi.useRealTimers()
  })

  it('shows the account and updates online state to offline after a failed probe', async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <SamwooConnectionStatusDot />
        </TooltipProvider>
      )
      await Promise.resolve()
    })
    expect(container.textContent).toContain('SAMWOO server connected · kim')

    health.mockResolvedValue({ ok: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(container.textContent).toContain('SAMWOO server offline · kim')
  })
})
