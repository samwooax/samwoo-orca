import { create } from 'zustand'
import type { SamwooEventStreamStatus } from '../../../shared/samwoo-profile-messaging'

type SamwooMessageInboxState = {
  totalUnread: number
  messengerOpen: boolean
  requestedChannelKey: string | null
  eventStreamStatus: SamwooEventStreamStatus
  onlineLogins: ReadonlySet<string>
  setTotalUnread: (count: number) => void
  setMessengerOpen: (open: boolean) => void
  setEventStreamStatus: (status: SamwooEventStreamStatus) => void
  setOnlineLogins: (logins: readonly string[]) => void
  openMessenger: (channelKey?: string) => void
}

export const useSamwooMessageInboxStore = create<SamwooMessageInboxState>((set) => ({
  totalUnread: 0,
  messengerOpen: false,
  requestedChannelKey: null,
  eventStreamStatus: 'disconnected',
  onlineLogins: new Set(),
  setTotalUnread: (count) =>
    set({ totalUnread: Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0 }),
  setMessengerOpen: (open) => set({ messengerOpen: open }),
  setEventStreamStatus: (status) =>
    set({
      eventStreamStatus: status,
      ...(status === 'connected' ? {} : { onlineLogins: new Set() })
    }),
  setOnlineLogins: (logins) => set({ onlineLogins: new Set(logins) }),
  openMessenger: (channelKey) => {
    set({ requestedChannelKey: channelKey ?? null })
    void window.api.messenger.openPopout(channelKey)
  }
}))
