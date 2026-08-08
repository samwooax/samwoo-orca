import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSamwooMessageInboxStore } from './samwoo-message-inbox-store'

describe('samwoo message inbox store', () => {
  const openPopout = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    openPopout.mockClear()
    vi.stubGlobal('window', { api: { messenger: { openPopout } } })
    useSamwooMessageInboxStore.setState({
      totalUnread: 0,
      messengerOpen: false,
      requestedChannelKey: null
    })
  })

  it('opens the messenger directly on a requested workspace channel', () => {
    useSamwooMessageInboxStore.getState().openMessenger('workspace:share-1')

    expect(useSamwooMessageInboxStore.getState()).toMatchObject({
      messengerOpen: false,
      requestedChannelKey: 'workspace:share-1'
    })
    expect(openPopout).toHaveBeenCalledWith('workspace:share-1')
  })

  it('clears a stale channel request when opened from the sidebar', () => {
    useSamwooMessageInboxStore.getState().openMessenger('workspace:share-1')
    useSamwooMessageInboxStore.getState().openMessenger()

    expect(useSamwooMessageInboxStore.getState()).toMatchObject({
      messengerOpen: false,
      requestedChannelKey: null
    })
    expect(openPopout).toHaveBeenLastCalledWith(undefined)
  })
})
