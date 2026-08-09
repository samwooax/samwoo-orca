// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamwooProfileEvent } from '../../../shared/samwoo-profile-messaging'

const mocks = vi.hoisted(() => {
  const appState = {
    workspaceHubOpen: false,
    openWorkspaceHubPage: vi.fn()
  }
  const useAppStore = Object.assign(
    vi.fn((selector: (state: typeof appState) => unknown) => selector(appState)),
    { getState: () => appState }
  )
  return {
    appState,
    useAppStore,
    logout: vi.fn(async () => undefined),
    retainToken: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: mocks.useAppStore }))
vi.mock('@/lib/samwoo-auth-store', () => ({
  useSamwooAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      auth: { login: 'peer', token: 'assignment-token-0123456789' },
      logout: mocks.logout
    })
}))
vi.mock('@/lib/samwoo-message-send-queue', () => ({
  samwooMessageSendQueue: { retainToken: mocks.retainToken }
}))

import { useSamwooWorkspaceAssignmentInboxStore } from '@/lib/samwoo-workspace-assignment-inbox-store'
import { useSamwooEventStream } from './useSamwooEventStream'

describe('useSamwooEventStream workspace assignments', () => {
  let eventListener: ((event: SamwooProfileEvent) => void) | null
  let notifications: { title: string; body?: string; onclick: (() => void) | null }[]

  beforeEach(() => {
    eventListener = null
    notifications = []
    mocks.appState.workspaceHubOpen = false
    mocks.appState.openWorkspaceHubPage.mockClear()
    useSamwooWorkspaceAssignmentInboxStore.getState().clear()
    class TestNotification {
      onclick: (() => void) | null = null
      constructor(
        public title: string,
        options?: { body?: string }
      ) {
        notifications.push(this)
        Object.assign(this, options)
      }
    }
    vi.stubGlobal('Notification', TestNotification)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        samwooEventStream: {
          start: vi.fn(async () => undefined),
          stop: vi.fn(async () => undefined),
          getState: vi.fn(async () => ({ status: 'connected', onlineLogins: [] })),
          onEvent: vi.fn((listener) => {
            eventListener = listener
            return vi.fn()
          }),
          onStatus: vi.fn(() => vi.fn())
        }
      }
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('shows one OS alert and badge for a newly assigned workspace', () => {
    renderHook(() => useSamwooEventStream(true))
    act(() => {
      eventListener?.({
        type: 'workspace-assignees',
        shareId: 'share-1',
        displayName: 'Design',
        addedLogins: ['peer'],
        updatedBy: 'owner',
        updatedAt: 123
      })
    })

    expect(useSamwooWorkspaceAssignmentInboxStore.getState().unreadShareIds).toEqual(
      new Set(['share-1'])
    )
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      title: 'Workspace assigned',
      body: 'You were assigned to Design.'
    })
    notifications[0]?.onclick?.()
    expect(mocks.appState.openWorkspaceHubPage).toHaveBeenCalledOnce()
  })

  it('refreshes an open hub without raising a duplicate alert', () => {
    const refreshed = vi.fn()
    window.addEventListener('samwoo-workspace-assignees-updated', refreshed)
    mocks.appState.workspaceHubOpen = true
    renderHook(() => useSamwooEventStream(true))
    act(() => {
      eventListener?.({
        type: 'workspace-assignees',
        shareId: 'share-1',
        displayName: 'Design',
        addedLogins: ['peer'],
        updatedBy: 'owner',
        updatedAt: 123
      })
    })

    expect(refreshed).toHaveBeenCalledOnce()
    expect(notifications).toHaveLength(0)
    expect(useSamwooWorkspaceAssignmentInboxStore.getState().unreadShareIds.size).toBe(0)
    window.removeEventListener('samwoo-workspace-assignees-updated', refreshed)
  })
})
