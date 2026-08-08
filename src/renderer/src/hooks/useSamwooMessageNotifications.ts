import { useEffect, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'
import {
  decideSamwooMessageNotifications,
  type SamwooChannelSeenState
} from '@/lib/samwoo-message-notification-decision'
import { samwooMessagePollingCadence } from '@/lib/samwoo-message-polling-cadence'

function showOsNotification(title: string, body: string, channelKey: string): void {
  if (typeof Notification === 'undefined') {
    return
  }
  try {
    const notification = new Notification(title, { body, silent: false })
    notification.onclick = () => void window.api.messenger.openPopout(channelKey)
  } catch {
    // Notification delivery must not interrupt inbox polling.
  }
}

export function useSamwooMessageNotifications(): void {
  const token = useSamwooAuthStore((state) => state.auth?.token)
  const ownLogin = useSamwooAuthStore((state) => state.auth?.login)
  const eventStreamStatus = useSamwooMessageInboxStore((state) => state.eventStreamStatus)
  const seenRef = useRef<SamwooChannelSeenState | null>(null)

  useEffect(() => {
    // Why: switching accounts must restart the silent first poll.
    seenRef.current = null
  }, [ownLogin, token])

  useEffect(() => {
    if (!token || !ownLogin) {
      useSamwooMessageInboxStore.getState().setTotalUnread(0)
      return
    }
    let disposed = false
    let polling = false
    let pollAgain = false
    const pollOnce = async (): Promise<void> => {
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
      // Why: main receives the companion window's real focus state over IPC.
      if (!inbox.messengerOpen) {
        for (const notification of notifications) {
          showOsNotification(notification.title, notification.body, notification.channelKey)
        }
      }
    }
    const poll = async (): Promise<void> => {
      if (polling) {
        pollAgain = true
        return
      }
      polling = true
      do {
        pollAgain = false
        await pollOnce()
      } while (pollAgain && !disposed)
      polling = false
    }
    const offEvent = window.api.samwooEventStream.onEvent((event) => {
      if (event.type === 'message' || (event.type === 'read' && event.login === ownLogin)) {
        void poll()
      }
    })
    void poll()
    const pollMs = samwooMessagePollingCadence(eventStreamStatus).inboxMs
    const interval = window.setInterval(() => void poll(), pollMs)
    return () => {
      disposed = true
      window.clearInterval(interval)
      offEvent()
    }
  }, [eventStreamStatus, ownLogin, token])
}
