import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'
import { registerSamwooWorkspaceSharingHandlers } from './samwoo-workspace-sharing'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))
vi.mock('./samwoo-workspace-share-client', () => ({ postSamwooWorkspaceShare: vi.fn() }))
vi.mock('./samwoo-profile-messaging', () => ({
  registerSamwooProfileMessagingHandlers: vi.fn()
}))
vi.mock('./samwoo-profile-members', () => ({ registerSamwooProfileMemberHandlers: vi.fn() }))
vi.mock('./samwoo-workspace-file-sync', () => ({
  registerSamwooWorkspaceFileSyncHandlers: vi.fn()
}))

const TOKEN = 'workspace-assignee-token-0123456789'

describe('SAMWOO workspace assignee IPC', () => {
  beforeEach(() => {
    handlers.clear()
    vi.mocked(postSamwooWorkspaceShare).mockReset().mockResolvedValue({ ok: true })
    registerSamwooWorkspaceSharingHandlers()
  })

  it('forwards only the validated assignment fields', async () => {
    const handler = handlers.get('samwooWorkspaceShares:updateAssignees')
    await handler?.(
      {},
      {
        token: TOKEN,
        shareId: 'share-1',
        assigneeLogins: ['owner', 123, 'peer'],
        ownerProfile: 'sales'
      }
    )

    expect(postSamwooWorkspaceShare).toHaveBeenCalledWith(
      '/workspace-shares/assignees/update',
      TOKEN,
      { shareId: 'share-1', assigneeLogins: ['owner', 'peer'] }
    )
  })

  it('rejects malformed assignment requests before networking', async () => {
    const handler = handlers.get('samwooWorkspaceShares:updateAssignees')
    await expect(
      handler?.({}, { token: 'short', shareId: 'share-1', assigneeLogins: [] })
    ).resolves.toEqual({ ok: false, error: 'login required' })
    expect(postSamwooWorkspaceShare).not.toHaveBeenCalled()
  })

  it('forwards a nullable due date without renderer-owned profile fields', async () => {
    const handler = handlers.get('samwooWorkspaceShares:updateDueDate')
    await handler?.(
      {},
      {
        token: TOKEN,
        shareId: 'share-1',
        dueDate: '2026-08-31',
        ownerProfile: 'sales'
      }
    )

    expect(postSamwooWorkspaceShare).toHaveBeenCalledWith(
      '/workspace-shares/due-date/update',
      TOKEN,
      { shareId: 'share-1', dueDate: '2026-08-31' }
    )

    await handler?.({}, { token: TOKEN, shareId: 'share-1', dueDate: null })
    expect(postSamwooWorkspaceShare).toHaveBeenLastCalledWith(
      '/workspace-shares/due-date/update',
      TOKEN,
      { shareId: 'share-1', dueDate: null }
    )
  })
})
