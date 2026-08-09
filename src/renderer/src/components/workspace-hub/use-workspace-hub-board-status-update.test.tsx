// @vitest-environment happy-dom

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'

const { authState, logoutMock, toastErrorMock, updateBoardStatusMock } = vi.hoisted(() => ({
  authState: {
    auth: {
      login: 'owner',
      name: 'Owner',
      role: 'ai_center',
      label: 'AI Center',
      token: 'test-session-token-1234567890'
    }
  },
  logoutMock: vi.fn(async () => undefined),
  toastErrorMock: vi.fn(),
  updateBoardStatusMock: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))
vi.mock('@/lib/samwoo-auth-store', () => ({
  useSamwooAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ auth: authState.auth, logout: logoutMock })
}))

import { useWorkspaceHubBoardStatusUpdate } from './use-workspace-hub-board-status-update'

function share(overrides: Partial<SamwooWorkspaceShare> = {}): SamwooWorkspaceShare {
  return {
    id: 'share-1',
    ownerLogin: 'owner',
    ownerProfile: 'ai_center',
    displayName: 'Project',
    permission: 'contribute',
    createdAt: 1,
    updatedAt: 1,
    boardStatus: 'todo',
    isOwner: true,
    commentCount: 0,
    ...overrides
  }
}

describe('useWorkspaceHubBoardStatusUpdate', () => {
  beforeEach(() => {
    logoutMock.mockClear()
    toastErrorMock.mockClear()
    updateBoardStatusMock.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preflight: {
          samwooWorkspaceShares: { updateBoardStatus: updateBoardStatusMock }
        }
      }
    })
  })

  it('persists a board move through the central API and refreshes the shared catalog', async () => {
    updateBoardStatusMock.mockResolvedValue({ ok: true, share: share({ boardStatus: 'done' }) })
    const onRefresh = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      useWorkspaceHubBoardStatusUpdate({ shares: [share()], onRefresh })
    )

    let updated = false
    await act(async () => {
      updated = await result.current.updateBoardStatus('share-1', 'done')
    })

    expect(updated).toBe(true)
    expect(updateBoardStatusMock).toHaveBeenCalledWith({
      token: 'test-session-token-1234567890',
      shareId: 'share-1',
      status: 'done'
    })
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(result.current.updatingShareId).toBeNull()
  })

  it('does not call the server for a read-only shared workspace', async () => {
    const onRefresh = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      useWorkspaceHubBoardStatusUpdate({
        shares: [share({ isOwner: false, permission: 'download' })],
        onRefresh
      })
    )

    await act(async () => {
      expect(await result.current.updateBoardStatus('share-1', 'done')).toBe(false)
    })

    expect(updateBoardStatusMock).not.toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledOnce()
  })
})
