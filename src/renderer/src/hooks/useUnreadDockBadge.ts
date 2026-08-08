import { useEffect } from 'react'
import { getUnreadBadgeCount } from '@/lib/unread-badge-count'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'
import { useAppStore } from '@/store'

function setUnreadDockBadgeCountBestEffort(count: number): void {
  void window.api.app.setUnreadDockBadgeCount(count).catch(() => {
    // Dock sync is best-effort chrome; stale badge state should not affect app use.
  })
}

export function clearUnreadDockBadgeCount(): void {
  setUnreadDockBadgeCountBestEffort(0)
}

export function useUnreadDockBadge(): typeof clearUnreadDockBadgeCount {
  const unreadCount = useAppStore((state) =>
    getUnreadBadgeCount({
      worktreesByRepo: state.worktreesByRepo,
      tabsByWorktree: state.tabsByWorktree,
      unreadTerminalTabs: state.unreadTerminalTabs
    })
  )
  const messageUnread = useSamwooMessageInboxStore((state) => state.totalUnread)

  // oxlint-disable-next-line react-doctor/no-derived-state-effect -- Why: this syncs an external OS dock badge, not React render state.
  useEffect(() => {
    setUnreadDockBadgeCountBestEffort(unreadCount + messageUnread)
  }, [messageUnread, unreadCount])

  return clearUnreadDockBadgeCount
}
