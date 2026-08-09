import { create } from 'zustand'

type SamwooWorkspaceAssignmentInboxState = {
  unreadShareIds: ReadonlySet<string>
  markAssigned: (shareId: string) => void
  clear: () => void
}

export const useSamwooWorkspaceAssignmentInboxStore = create<SamwooWorkspaceAssignmentInboxState>(
  (set) => ({
    unreadShareIds: new Set(),
    markAssigned: (shareId) =>
      set((state) => ({ unreadShareIds: new Set(state.unreadShareIds).add(shareId) })),
    clear: () => set({ unreadShareIds: new Set() })
  })
)
