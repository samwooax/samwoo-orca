// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { SamwooAuthStatusSegment } from './SamwooAuthStatusSegment'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderSegment(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<SamwooAuthStatusSegment />)
  })
}

describe('SamwooAuthStatusSegment', () => {
  beforeEach(() => {
    localStorage.clear()
    useSamwooAuthStore.setState({ auth: null })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preflight: {
          samwooWorkspaceShares: {
            revokeSession: vi.fn(async () => ({ ok: true }))
          }
        }
      }
    })
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
    }
    root = null
    container?.remove()
    container = null
  })

  it('stays hidden before groupware sign-in', async () => {
    await renderSegment()
    expect(container?.querySelector('button')).toBeNull()
  })

  it('clears the saved session and returns the app to its login gate', async () => {
    const auth = {
      login: 'kdhoon',
      name: '김동훈',
      role: 'ai_center',
      label: 'AI Center',
      token: 'expired-session-token-long-enough'
    }
    useSamwooAuthStore.getState().setAuth(auth)
    await renderSegment()

    const button = container?.querySelector('button')
    expect(button?.textContent).toContain('김동훈')
    expect(localStorage.getItem('samwoo.auth')).toContain('expired-session-token-long-enough')

    await act(async () => button?.click())

    expect(window.api.preflight.samwooWorkspaceShares.revokeSession).toHaveBeenCalledWith(
      'expired-session-token-long-enough'
    )
    expect(useSamwooAuthStore.getState().auth).toBeNull()
    expect(localStorage.getItem('samwoo.auth')).toBeNull()
    expect(container?.querySelector('button')).toBeNull()
  })
})
