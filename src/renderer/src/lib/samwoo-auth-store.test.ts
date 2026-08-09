// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'samwoo.auth'

describe('SAMWOO auth store hydration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('clears a legacy persisted login that has no session token', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        login: 'owner',
        name: 'Owner',
        role: 'ai_center',
        label: 'AI Center'
      })
    )

    const { useSamwooAuthStore } = await import('./samwoo-auth-store')

    expect(useSamwooAuthStore.getState().auth).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('restores a complete persisted login session', async () => {
    const auth = {
      login: 'owner',
      name: 'Owner',
      role: 'ai_center',
      label: 'AI Center',
      token: 'session-token-long-enough'
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))

    const { useSamwooAuthStore } = await import('./samwoo-auth-store')

    expect(useSamwooAuthStore.getState().auth).toEqual(auth)
  })

  it('canonicalizes an email login while restoring and persists the repaired session', async () => {
    const auth = {
      login: ' Member@Company.Test ',
      name: 'Member',
      role: 'planning',
      label: 'Planning',
      token: 'session-token-long-enough'
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))

    const { useSamwooAuthStore } = await import('./samwoo-auth-store')

    expect(useSamwooAuthStore.getState().auth?.login).toBe('member')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').login).toBe('member')
  })

  it('canonicalizes a newly signed-in session before storing it', async () => {
    const { useSamwooAuthStore } = await import('./samwoo-auth-store')

    useSamwooAuthStore.getState().setAuth({
      login: 'MEMBER@Company.Test',
      name: 'Member',
      role: 'planning',
      label: 'Planning',
      token: 'session-token-long-enough'
    })

    expect(useSamwooAuthStore.getState().auth?.login).toBe('member')
  })
})
