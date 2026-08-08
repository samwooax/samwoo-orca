import { create } from 'zustand'

type SamwooMessageInboxState = {
  totalUnread: number
  messengerOpen: boolean
  setTotalUnread: (count: number) => void
  setMessengerOpen: (open: boolean) => void
}

export const useSamwooMessageInboxStore = create<SamwooMessageInboxState>((set) => ({
  totalUnread: 0,
  messengerOpen: false,
  setTotalUnread: (count) =>
    set({ totalUnread: Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0 }),
  setMessengerOpen: (open) => set({ messengerOpen: open })
}))
