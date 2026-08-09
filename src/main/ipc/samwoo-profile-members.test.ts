import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'
import { registerSamwooProfileMemberHandlers } from './samwoo-profile-members'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))
vi.mock('./samwoo-workspace-share-client', () => ({ postSamwooWorkspaceShare: vi.fn() }))

const TOKEN = 'profile-member-token-0123456789'

beforeEach(() => {
  handlers.clear()
  vi.mocked(postSamwooWorkspaceShare).mockReset().mockResolvedValue({ ok: true })
  registerSamwooProfileMemberHandlers()
})

describe('SAMWOO profile member IPC', () => {
  it('forwards only the bearer token and never accepts a renderer profile', async () => {
    const handler = handlers.get('samwooProfileMembers:list')
    await handler?.({}, TOKEN, { profile: 'sales' })
    expect(postSamwooWorkspaceShare).toHaveBeenCalledWith('/profile-members/list', TOKEN)
  })

  it('rejects invalid tokens before the network request', async () => {
    const handler = handlers.get('samwooProfileMembers:list')
    await expect(handler?.({}, 'short')).resolves.toEqual({
      ok: false,
      error: 'login required'
    })
    expect(postSamwooWorkspaceShare).not.toHaveBeenCalled()
  })
})
