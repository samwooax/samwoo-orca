// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@/lib/unread-badge-count', () => ({
  getUnreadBadgeCount: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: vi.fn()
}))

import { getUnreadBadgeCount } from '@/lib/unread-badge-count'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'
import { useSamwooWorkspaceAssignmentInboxStore } from '@/lib/samwoo-workspace-assignment-inbox-store'
import { useAppStore } from '@/store'
import { clearUnreadDockBadgeCount, useUnreadDockBadge } from './useUnreadDockBadge'

describe('clearUnreadDockBadgeCount', () => {
  let setUnreadDockBadgeCount: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setUnreadDockBadgeCount = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      api: {
        app: {
          setUnreadDockBadgeCount
        }
      }
    })
    vi.mocked(getUnreadBadgeCount).mockReturnValue(3)
    vi.mocked(useAppStore).mockImplementation((selector) =>
      selector({ worktreesByRepo: {}, tabsByWorktree: {}, unreadTerminalTabs: new Set() } as never)
    )
    useSamwooMessageInboxStore.setState({ totalUnread: 4 })
    useSamwooWorkspaceAssignmentInboxStore.getState().clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears the app badge', () => {
    clearUnreadDockBadgeCount()

    expect(setUnreadDockBadgeCount).toHaveBeenCalledWith(0)
  })

  it('treats badge clearing as best-effort', async () => {
    setUnreadDockBadgeCount.mockRejectedValueOnce(new Error('dock unavailable'))

    clearUnreadDockBadgeCount()
    await Promise.resolve()

    expect(setUnreadDockBadgeCount).toHaveBeenCalledWith(0)
  })

  it('includes unseen workspace assignments in the OS badge total', () => {
    const assignments = useSamwooWorkspaceAssignmentInboxStore.getState()
    assignments.markAssigned('share-1')
    assignments.markAssigned('share-2')
    renderHook(() => useUnreadDockBadge())

    expect(setUnreadDockBadgeCount).toHaveBeenLastCalledWith(9)
  })
})
