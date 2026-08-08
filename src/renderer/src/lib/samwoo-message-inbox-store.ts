import { create } from 'zustand'

type SamwooMessageInboxState = {
  totalUnread: number
  messengerOpen: boolean
  requestedChannelKey: string | null
  setTotalUnread: (count: number) => void
  setMessengerOpen: (open: boolean) => void
  openMessenger: (channelKey?: string) => void
}

export const useSamwooMessageInboxStore = create<SamwooMessageInboxState>((set) => ({
  totalUnread: 0,
  messengerOpen: false,
  requestedChannelKey: null,
  setTotalUnread: (count) =>
    set({ totalUnread: Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0 }),
  setMessengerOpen: (open) => set({ messengerOpen: open }),
  openMessenger: (channelKey) => {
    set({ requestedChannelKey: channelKey ?? null })
    void window.api.messenger.openPopout(channelKey)
  }
}))
