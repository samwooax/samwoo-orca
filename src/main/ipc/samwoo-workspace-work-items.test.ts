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

const TOKEN = 'workspace-work-item-token-0123456789'

describe('SAMWOO workspace work item IPC', () => {
  beforeEach(() => {
    handlers.clear()
    vi.mocked(postSamwooWorkspaceShare).mockReset().mockResolvedValue({ ok: true })
    registerSamwooWorkspaceSharingHandlers()
  })

  it.each([
    [
      'samwooWorkspaceShares:listWorkItems',
      '/workspace-shares/work-items/list',
      { token: TOKEN, shareId: 'share-1', ownerProfile: 'sales' },
      { shareId: 'share-1' }
    ],
    [
      'samwooWorkspaceShares:createWorkItem',
      '/workspace-shares/work-items/create',
      { token: TOKEN, shareId: 'share-1', title: 'Review BOM', ownerProfile: 'sales' },
      { shareId: 'share-1', title: 'Review BOM' }
    ],
    [
      'samwooWorkspaceShares:setWorkItemCompleted',
      '/workspace-shares/work-items/complete',
      {
        token: TOKEN,
        shareId: 'share-1',
        workItemId: 'item-1',
        completed: true,
        ownerProfile: 'sales'
      },
      { shareId: 'share-1', workItemId: 'item-1', completed: true }
    ],
    [
      'samwooWorkspaceShares:setWorkItemAssignee',
      '/workspace-shares/work-items/assignee',
      {
        token: TOKEN,
        shareId: 'share-1',
        workItemId: 'item-1',
        assigneeLogin: null,
        ownerProfile: 'sales'
      },
      { shareId: 'share-1', workItemId: 'item-1', assigneeLogin: null }
    ]
  ])('whitelists fields for %s', async (channel, path, args, body) => {
    await handlers.get(channel)?.({}, args)
    expect(postSamwooWorkspaceShare).toHaveBeenCalledWith(path, TOKEN, body)
  })

  it('rejects malformed completion before networking', async () => {
    const handler = handlers.get('samwooWorkspaceShares:setWorkItemCompleted')
    await expect(
      handler?.({}, { token: TOKEN, shareId: 'share-1', workItemId: 'item-1', completed: 'yes' })
    ).resolves.toEqual({ ok: false, error: 'login required' })
    expect(postSamwooWorkspaceShare).not.toHaveBeenCalled()
  })
})
