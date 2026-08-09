// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import SamwooServerConnectionIndicator from './SamwooServerConnectionIndicator'

describe('SamwooServerConnectionIndicator', () => {
  let root: Root
  let container: HTMLDivElement
  const health = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    health.mockResolvedValue({ ok: true, latencyMs: 12 })
    useSamwooAuthStore.setState({
      auth: { login: 'member', name: 'Member', role: 'planning', label: 'Planning', token: 'token' }
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

  it('shares one health probe across every Hermes tab without rendering account text', async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <SamwooServerConnectionIndicator />
          <SamwooServerConnectionIndicator />
        </TooltipProvider>
      )
      await Promise.resolve()
    })

    expect(health).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('[data-status="online"]')).toHaveLength(2)
    expect(container.textContent).toBe('')

    health.mockResolvedValue({ ok: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(health).toHaveBeenCalledTimes(2)
    expect(container.querySelectorAll('[data-status="offline"]')).toHaveLength(2)
  })
})
