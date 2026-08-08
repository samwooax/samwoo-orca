import { useEffect, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'
import {
  decideSamwooMessageNotifications,
  type SamwooChannelSeenState
} from '@/lib/samwoo-message-notification-decision'

const POLL_MS = 30_000

function showOsNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined') {
    return
  }
  try {
    const notification = new Notification(title, { body, silent: false })
    // Why: focusing the app is the safe notification-click behavior on every desktop platform.
    notification.onclick = () => window.focus()
  } catch {
    // Notification delivery must not interrupt inbox polling.
  }
}

export function useSamwooMessageNotifications(): void {
  const token = useSamwooAuthStore((state) => state.auth?.token)
  const ownLogin = useSamwooAuthStore((state) => state.auth?.login)
  const seenRef = useRef<SamwooChannelSeenState | null>(null)

  useEffect(() => {
    // Why: switching accounts must restart the silent first poll.
    seenRef.current = null
    if (!token || !ownLogin) {
      useSamwooMessageInboxStore.getState().setTotalUnread(0)
      return
    }
    let disposed = false
    const poll = async (): Promise<void> => {
      const result = await window.api.preflight.samwooProfileMessages.listChannels(token)
      if (disposed || !result.ok) {
        return
      }
      const channels = result.channels ?? []
      const inbox = useSamwooMessageInboxStore.getState()
      inbox.setTotalUnread(channels.reduce((total, channel) => total + channel.unreadCount, 0))
      const { notifications, nextSeen } = decideSamwooMessageNotifications({
        seen: seenRef.current,
        channels,
        ownLogin,
        teamChannelLabel: translate('samwoo.profileMessages.teamChat', 'Team chat'),
        aggregateTitle: translate('samwoo.profileMessages.newMessages', 'New messages'),
        aggregateBody: (hiddenChannelCount) =>
          translate(
            'samwoo.profileMessages.newMessagesInMoreChannels',
            'New messages in {{count}} more conversations',
            { count: hiddenChannelCount }
          )
      })
      seenRef.current = nextSeen
      // Why: a focused open messenger already presents the same messages.
      if (!(inbox.messengerOpen && document.hasFocus())) {
        for (const notification of notifications) {
          showOsNotification(notification.title, notification.body)
        }
      }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [ownLogin, token])
}
