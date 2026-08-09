// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'

const { logoutMock, updateDueDateMock } = vi.hoisted(() => ({
  logoutMock: vi.fn(async () => undefined),
  updateDueDateMock: vi.fn()
}))

vi.mock('@/lib/samwoo-auth-store', () => ({
  useSamwooAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      auth: { login: 'owner', token: 'test-session-token-1234567890' },
      logout: logoutMock
    })
}))

import { useWorkspaceHubDueDate } from './use-workspace-hub-due-date'

const share: SamwooWorkspaceShare = {
  id: 'share-1',
  ownerLogin: 'owner',
  ownerProfile: 'ai_center',
  displayName: 'Project',
  permission: 'contribute',
  createdAt: 1,
  updatedAt: 1,
  isOwner: true,
  commentCount: 0
}

describe('useWorkspaceHubDueDate', () => {
  beforeEach(() => {
    logoutMock.mockClear()
    updateDueDateMock.mockReset().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { preflight: { samwooWorkspaceShares: { updateDueDate: updateDueDateMock } } }
    })
  })

  it('persists and clears a due date through the central API', async () => {
    const onRefresh = vi.fn(async () => undefined)
    const { result } = renderHook(() => useWorkspaceHubDueDate({ shares: [share], onRefresh }))

    await act(async () => {
      expect(await result.current.updateDueDate('share-1', '2026-08-31')).toBe(true)
      expect(await result.current.updateDueDate('share-1', null)).toBe(true)
    })

    expect(updateDueDateMock).toHaveBeenNthCalledWith(1, {
      token: 'test-session-token-1234567890',
      shareId: 'share-1',
      dueDate: '2026-08-31'
    })
    expect(updateDueDateMock).toHaveBeenNthCalledWith(2, {
      token: 'test-session-token-1234567890',
      shareId: 'share-1',
      dueDate: null
    })
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('does not call the API for a download-only member', async () => {
    const { result } = renderHook(() =>
      useWorkspaceHubDueDate({
        shares: [{ ...share, isOwner: false, permission: 'download' }],
        onRefresh: vi.fn(async () => undefined)
      })
    )

    await act(async () => {
      expect(await result.current.updateDueDate('share-1', '2026-08-31')).toBe(false)
    })
    expect(updateDueDateMock).not.toHaveBeenCalled()
  })

  it('logs out when the central API reports an expired session', async () => {
    updateDueDateMock.mockResolvedValue({ ok: false, error: 'invalid or expired session' })
    const { result } = renderHook(() =>
      useWorkspaceHubDueDate({ shares: [share], onRefresh: vi.fn(async () => undefined) })
    )

    await act(async () => {
      expect(await result.current.updateDueDate('share-1', '2026-08-31')).toBe(false)
    })
    expect(logoutMock).toHaveBeenCalledOnce()
  })
})
