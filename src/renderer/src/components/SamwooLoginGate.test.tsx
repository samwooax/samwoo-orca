// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import SamwooLoginGate from './SamwooLoginGate'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settings: { theme: string } }) => unknown) =>
    selector({ settings: { theme: 'light' } })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderGate(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<SamwooLoginGate />)
  })
}

describe('SamwooLoginGate', () => {
  beforeEach(() => {
    localStorage.clear()
    useSamwooAuthStore.setState({ auth: null })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
    }
    root = null
    container?.remove()
    container = null
  })

  it('covers every app dialog after the session is cleared', async () => {
    const auth = {
      login: 'kdhoon',
      name: '김동훈',
      role: 'ai_center',
      label: 'AI Center',
      token: 'session-token-long-enough'
    }
    useSamwooAuthStore.getState().setAuth(auth)
    await renderGate()

    expect(container?.querySelector('form')).toBeNull()

    await act(async () => {
      useSamwooAuthStore.setState({ auth: null })
    })

    const loginLayer = container?.querySelector('form')?.parentElement
    expect(loginLayer?.className).toContain('z-[200]')
    expect(loginLayer?.className).toContain('bg-background')
  })
})
