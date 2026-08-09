// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'

const { loadMembersMock, updateAssigneesMock } = vi.hoisted(() => ({
  loadMembersMock: vi.fn(async () => undefined),
  updateAssigneesMock: vi.fn()
}))

vi.mock('@/lib/samwoo-auth-store', () => ({
  useSamwooAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      auth: { login: 'owner', token: 'test-session-token-1234567890' },
      logout: vi.fn(async () => undefined)
    })
}))
vi.mock('@/lib/samwoo-profile-member-store', () => ({
  useSamwooProfileMemberStore: (selector: (state: unknown) => unknown) =>
    selector({ members: [{ login: 'peer', name: '동료' }], load: loadMembersMock })
}))

import { useWorkspaceHubAssignees } from './use-workspace-hub-assignees'

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

describe('useWorkspaceHubAssignees', () => {
  beforeEach(() => {
    loadMembersMock.mockClear()
    updateAssigneesMock.mockReset().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preflight: { samwooWorkspaceShares: { updateAssignees: updateAssigneesMock } }
      }
    })
  })

  it('loads the profile directory and persists assignees through the central API', async () => {
    const onRefresh = vi.fn(async () => undefined)
    const { result } = renderHook(() => useWorkspaceHubAssignees({ shares: [share], onRefresh }))

    await act(async () => {
      expect(await result.current.updateAssignees('share-1', ['peer'])).toBe(true)
    })

    expect(loadMembersMock).toHaveBeenCalledWith('test-session-token-1234567890', 'owner')
    expect(updateAssigneesMock).toHaveBeenCalledWith({
      token: 'test-session-token-1234567890',
      shareId: 'share-1',
      assigneeLogins: ['peer']
    })
    expect(onRefresh).toHaveBeenCalledOnce()
  })
})
