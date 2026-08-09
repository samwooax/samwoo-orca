import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'
import { samwooMessageSendQueue } from '@/lib/samwoo-message-send-queue'
import { useSamwooWorkspaceAssignmentInboxStore } from '@/lib/samwoo-workspace-assignment-inbox-store'
import { isWorkspaceAssignmentForLogin } from '@/lib/samwoo-workspace-assignment-notification'
import { useAppStore } from '@/store'

function showWorkspaceAssignmentNotification(displayName: string): void {
  if (typeof Notification === 'undefined') {
    return
  }
  try {
    const notification = new Notification(
      translate('samwoo.workspaceHub.assignedNotificationTitle', 'Workspace assigned'),
      {
        body: translate(
          'samwoo.workspaceHub.assignedNotificationBody',
          'You were assigned to {{name}}.',
          { name: displayName }
        ),
        silent: false
      }
    )
    notification.onclick = () => useAppStore.getState().openWorkspaceHubPage()
  } catch {
    // OS notification delivery must not interrupt the event stream.
  }
}

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
      if (ownsConnection && event.type === 'workspace-assignees') {
        window.dispatchEvent(new CustomEvent('samwoo-workspace-assignees-updated'))
        if (
          auth?.login &&
          isWorkspaceAssignmentForLogin(event, auth.login) &&
          !useAppStore.getState().workspaceHubOpen
        ) {
          useSamwooWorkspaceAssignmentInboxStore.getState().markAssigned(event.shareId)
          showWorkspaceAssignmentNotification(event.displayName)
        }
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
  }, [auth?.login, logout, ownsConnection])

  useEffect(() => {
    useSamwooWorkspaceAssignmentInboxStore.getState().clear()
  }, [auth?.login])

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
