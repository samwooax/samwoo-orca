import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { samwooMessageSendQueue } from '@/lib/samwoo-message-send-queue'
import { canonicalSamwooLogin } from '../../../../shared/samwoo-login-identity'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'
import { mergeProfileMessages } from './ProfileMessageRow'

type Options = {
  ownLogin?: string
  activeChannelKeyRef: { current: string }
  selectedChannelKey?: string
  setMessages: Dispatch<SetStateAction<SamwooProfileMessage[]>>
  handleSessionError: (error: string | undefined, fallback: string) => void
  refreshChannels: (showError?: boolean) => Promise<void>
  refreshMessages: (showProgress?: boolean) => Promise<void>
}

export function normalizeSamwooEventMessage(
  message: SamwooProfileMessage,
  ownLogin?: string
): SamwooProfileMessage {
  return {
    ...message,
    isAuthor: canonicalSamwooLogin(message.authorLogin) === canonicalSamwooLogin(ownLogin)
  }
}

export function useProfileMessageLiveUpdates(options: Options): void {
  const {
    ownLogin,
    activeChannelKeyRef,
    selectedChannelKey,
    setMessages,
    handleSessionError,
    refreshChannels,
    refreshMessages
  } = options
  const latestRef = useRef({ ownLogin, refreshChannels, refreshMessages })
  latestRef.current = { ownLogin, refreshChannels, refreshMessages }
  const syncPendingMessages = useCallback(
    (channelKey: string): void => {
      const pending = samwooMessageSendQueue.pendingMessages(channelKey)
      setMessages((current) =>
        mergeProfileMessages(
          current.filter((message) => !message.deliveryState),
          pending
        )
      )
    },
    [setMessages]
  )

  useEffect(() => {
    if (selectedChannelKey) {
      syncPendingMessages(selectedChannelKey)
    }
  }, [selectedChannelKey, syncPendingMessages])

  useEffect(
    () =>
      samwooMessageSendQueue.subscribe((event) => {
        if (event.type === 'session-expired') {
          handleSessionError(event.error, '')
          return
        }
        if (event.channelKey !== activeChannelKeyRef.current) {
          return
        }
        if (event.type === 'confirmed') {
          setMessages((current) =>
            mergeProfileMessages(
              current.filter((message) => message.id !== event.temporaryId),
              [normalizeSamwooEventMessage(event.message, latestRef.current.ownLogin)]
            )
          )
          void latestRef.current.refreshChannels(false)
          return
        }
        syncPendingMessages(event.channelKey)
      }),
    [activeChannelKeyRef, handleSessionError, setMessages, syncPendingMessages]
  )

  useEffect(
    () =>
      window.api.samwooEventStream.onEvent((event) => {
        if (event.type === 'message') {
          void latestRef.current.refreshChannels(false)
          if (event.channelKey === activeChannelKeyRef.current) {
            setMessages((current) =>
              mergeProfileMessages(current, [
                normalizeSamwooEventMessage(event.message, latestRef.current.ownLogin)
              ])
            )
            void latestRef.current.refreshMessages(false)
          }
        } else if (event.type === 'read') {
          if (event.channelKey === activeChannelKeyRef.current) {
            void latestRef.current.refreshMessages(false)
          }
          if (
            canonicalSamwooLogin(event.login) === canonicalSamwooLogin(latestRef.current.ownLogin)
          ) {
            void latestRef.current.refreshChannels(false)
          }
        }
      }),
    [activeChannelKeyRef, setMessages]
  )
}
