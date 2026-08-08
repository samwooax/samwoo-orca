import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'
import { samwooMessageSendQueue } from '@/lib/samwoo-message-send-queue'

export function useSamwooEventStream(ownsConnection: boolean): void {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)

  useEffect(() => {
    const inbox = useSamwooMessageInboxStore.getState()
    let receivedUpdate = false
    const applyStatus = (status: Parameters<typeof inbox.setEventStreamStatus>[0]): void => {
      useSamwooMessageInboxStore.getState().setEventStreamStatus(status)
      if (status === 'expired' && ownsConnection) {
        toast.error(
          translate(
            'samwoo.profileMessages.sessionExpired',
            'Your session has expired. Sign in again.'
          )
        )
        void logout()
      }
    }
    const offEvent = window.api.samwooEventStream.onEvent((event) => {
      receivedUpdate = true
      if (event.type === 'snapshot' || event.type === 'presence') {
        useSamwooMessageInboxStore.getState().setOnlineLogins(event.online)
      }
    })
    const offStatus = window.api.samwooEventStream.onStatus((status) => {
      receivedUpdate = true
      applyStatus(status)
    })
    void window.api.samwooEventStream.getState().then((state) => {
      if (receivedUpdate) {
        return
      }
      applyStatus(state.status)
      if (state.status === 'connected') {
        useSamwooMessageInboxStore.getState().setOnlineLogins(state.onlineLogins)
      }
    })
    return () => {
      receivedUpdate = true
      offEvent()
      offStatus()
      inbox.setEventStreamStatus('disconnected')
    }
  }, [logout, ownsConnection])

  useEffect(() => {
    samwooMessageSendQueue.retainToken(auth?.token ?? null)
    if (!ownsConnection) {
      return
    }
    if (auth?.token) {
      void window.api.samwooEventStream.start(auth.token)
    } else {
      void window.api.samwooEventStream.stop()
    }
    return () => {
      void window.api.samwooEventStream.stop()
    }
  }, [auth?.token, ownsConnection])
}
