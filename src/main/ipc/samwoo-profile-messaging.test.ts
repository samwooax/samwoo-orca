import { beforeEach, describe, expect, it, vi } from 'vitest'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'
import { registerSamwooProfileMessagingHandlers } from './samwoo-profile-messaging'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))
vi.mock('./samwoo-workspace-share-client', () => ({ postSamwooWorkspaceShare: vi.fn() }))

const TOKEN = 'profile-message-token-0123456789'

beforeEach(() => {
  handlers.clear()
  vi.mocked(postSamwooWorkspaceShare).mockReset().mockResolvedValue({ ok: true })
  registerSamwooProfileMessagingHandlers()
})

describe('SAMWOO profile messaging IPC', () => {
  it('forwards workspace channels without allowing the renderer to choose a profile', async () => {
    const handler = handlers.get('samwooProfileMessages:sendMessage')
    await handler?.(
      {},
      {
        token: TOKEN,
        channelKind: 'workspace',
        shareId: 'share-id',
        body: '확인',
        profile: 'sales'
      }
    )

    expect(postSamwooWorkspaceShare).toHaveBeenCalledWith(
      '/profile-messages/send',
      TOKEN,
      expect.not.objectContaining({ profile: 'sales' })
    )
  })

  it('rejects missing tokens before making a network request', async () => {
    const handler = handlers.get('samwooProfileMessages:listMessages')
    await expect(handler?.({}, { channelKind: 'team' })).resolves.toEqual({
      ok: false,
      error: 'login required'
    })
    expect(postSamwooWorkspaceShare).not.toHaveBeenCalled()
  })
})
