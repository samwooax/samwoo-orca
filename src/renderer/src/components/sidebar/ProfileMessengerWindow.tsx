import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'
import { isSamwooSessionError } from '@/lib/samwoo-session-validation'
import type {
  SamwooProfileMessage,
  SamwooProfileMessageChannel
} from '../../../../shared/samwoo-profile-messaging'
import ProfileMessageComposer from './ProfileMessageComposer'
import ProfileMessageTimeline from './ProfileMessageTimeline'
import ProfileMessengerChannelList from './ProfileMessengerChannelList'
import { mergeProfileMessages } from './ProfileMessageRow'
import {
  shouldApplyProfileMessageResponse,
  shouldMarkProfileMessagesRead
} from './profile-message-interaction-admission'
import { useProfileMessagePolling } from './use-profile-message-polling'

const OPEN_REFRESH_MS = 3_000
const BACKGROUND_REFRESH_MS = 30_000

export default function ProfileMessengerWindow({
  initialChannelKey
}: {
  initialChannelKey?: string | null
}): React.JSX.Element {
  const auth = useSamwooAuthStore((state) => state.auth)
  const onlineLogins = useSamwooMessageInboxStore(
    (state) => (state as typeof state & { onlineLogins?: readonly string[] }).onlineLogins
  )
  const [channels, setChannels] = useState<SamwooProfileMessageChannel[]>([])
  const [selectedKey, setSelectedKey] = useState(initialChannelKey ?? 'team')
  const [messages, setMessages] = useState<SamwooProfileMessage[]>([])
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<SamwooProfileMessage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const requestSequence = useRef(0)
  const activeChannelKeyRef = useRef(initialChannelKey ?? 'team')
  const lastMarkedMessageByChannelRef = useRef(new Map<string, string>())
  const messageViewportRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.key === selectedKey) ?? channels[0],
    [channels, selectedKey]
  )

  const handleError = useCallback((error: string | undefined, fallback: string): void => {
    if (isSamwooSessionError(error)) {
      toast.error(
        translate(
          'samwoo.profileMessages.sessionExpired',
          'Your session has expired. Sign in again.'
        )
      )
      useSamwooAuthStore.setState({ auth: null })
      void window.api.messenger.requestLogout()
      return
    }
    toast.error(error ?? fallback)
  }, [])

  const selectChannel = useCallback((channelKey: string): void => {
    activeChannelKeyRef.current = channelKey
    requestSequence.current += 1
    setMessages([])
    setReplyTo(null)
    stickToBottomRef.current = true
    setSelectedKey(channelKey)
  }, [])

  const refreshChannels = useCallback(
    async (showError = false): Promise<void> => {
      if (!auth?.token) {
        return
      }
      const result = await window.api.preflight.samwooProfileMessages.listChannels(auth.token)
      if (!result.ok) {
        if (showError) {
          handleError(
            result.error,
            translate('samwoo.profileMessages.channelsLoadFailed', 'Could not load conversations.')
          )
        }
        return
      }
      const nextChannels = result.channels ?? []
      setChannels(nextChannels)
      if (!nextChannels.some((channel) => channel.key === activeChannelKeyRef.current)) {
        selectChannel(nextChannels[0]?.key ?? 'team')
      }
      useSamwooMessageInboxStore
        .getState()
        .setTotalUnread(nextChannels.reduce((total, channel) => total + channel.unreadCount, 0))
    },
    [auth?.token, handleError, selectChannel]
  )

  const refreshMessages = useCallback(
    async (showProgress = false): Promise<void> => {
      if (!auth?.token || !selectedChannel) {
        return
      }
      const sequence = ++requestSequence.current
      if (showProgress) {
        setLoading(true)
      }
      const result = await window.api.preflight.samwooProfileMessages.listMessages({
        token: auth.token,
        channelKind: selectedChannel.kind,
        shareId: selectedChannel.shareId ?? undefined
      })
      if (showProgress) {
        setLoading(false)
      }
      if (sequence !== requestSequence.current) {
        return
      }
      if (!result.ok) {
        if (showProgress) {
          handleError(
            result.error,
            translate('samwoo.profileMessages.messagesLoadFailed', 'Could not load messages.')
          )
        }
        return
      }
      const nextMessages = result.messages ?? []
      setMessages((current) => mergeProfileMessages(current, nextMessages))
      setHasOlder(Boolean(result.hasMore))
      const latest = nextMessages.at(-1)
      if (
        latest &&
        shouldMarkProfileMessagesRead({
          messageId: latest.id,
          lastMarkedMessageId: lastMarkedMessageByChannelRef.current.get(selectedChannel.key),
          isAtBottom: stickToBottomRef.current,
          documentHasFocus: document.hasFocus()
        })
      ) {
        lastMarkedMessageByChannelRef.current.set(selectedChannel.key, latest.id)
        const readResult = await window.api.preflight.samwooProfileMessages.markRead({
          token: auth.token,
          channelKind: selectedChannel.kind,
          shareId: selectedChannel.shareId ?? undefined,
          messageId: latest.id
        })
        if (readResult.ok) {
          void refreshChannels(false)
        } else {
          lastMarkedMessageByChannelRef.current.delete(selectedChannel.key)
          if (isSamwooSessionError(readResult.error)) {
            handleError(readResult.error, '')
          }
        }
      }
    },
    [auth?.token, handleError, refreshChannels, selectedChannel]
  )

  useProfileMessagePolling({
    enabled: Boolean(auth?.token),
    refresh: refreshChannels,
    showInitialProgress: true,
    foregroundRefreshMs: OPEN_REFRESH_MS,
    backgroundRefreshMs: BACKGROUND_REFRESH_MS
  })
  useProfileMessagePolling({
    enabled: Boolean(auth?.token && selectedChannel),
    refresh: refreshMessages,
    showInitialProgress: true,
    foregroundRefreshMs: OPEN_REFRESH_MS,
    backgroundRefreshMs: BACKGROUND_REFRESH_MS
  })

  useEffect(() => window.api.messenger.onSelectChannel(selectChannel), [selectChannel])
  useEffect(() => {
    if (stickToBottomRef.current) {
      messageViewportRef.current?.scrollTo({
        top: messageViewportRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [messages])

  const loadOlder = async (): Promise<void> => {
    const oldest = messages[0]
    if (!auth?.token || !selectedChannel || !oldest || loadingOlder) {
      return
    }
    const requestedChannelKey = selectedChannel.key
    setLoadingOlder(true)
    const result = await window.api.preflight.samwooProfileMessages.listMessages({
      token: auth.token,
      channelKind: selectedChannel.kind,
      shareId: selectedChannel.shareId ?? undefined,
      beforeCreatedAt: oldest.createdAt,
      beforeId: oldest.id
    })
    setLoadingOlder(false)
    if (!shouldApplyProfileMessageResponse(requestedChannelKey, activeChannelKeyRef.current)) {
      return
    }
    if (!result.ok) {
      handleError(
        result.error,
        translate('samwoo.profileMessages.messagesLoadFailed', 'Could not load messages.')
      )
      return
    }
    setMessages((current) => mergeProfileMessages(result.messages ?? [], current))
    setHasOlder(Boolean(result.hasMore))
  }

  const sendMessage = async (): Promise<void> => {
    const body = draft.trim()
    if (!auth?.token || !selectedChannel || !body || sending) {
      return
    }
    const requestedChannelKey = selectedChannel.key
    setSending(true)
    const result = await window.api.preflight.samwooProfileMessages.sendMessage({
      token: auth.token,
      channelKind: selectedChannel.kind,
      shareId: selectedChannel.shareId ?? undefined,
      body,
      replyToId: replyTo?.id
    })
    setSending(false)
    if (!shouldApplyProfileMessageResponse(requestedChannelKey, activeChannelKeyRef.current)) {
      return
    }
    if (!result.ok || !result.message) {
      handleError(
        result.error,
        translate('samwoo.profileMessages.sendFailed', 'Could not send the message.')
      )
      return
    }
    setMessages((current) => mergeProfileMessages(current, [result.message!]))
    setDraft('')
    setReplyTo(null)
    void refreshChannels(false)
  }

  if (!auth?.token) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {translate('samwoo.profileMessages.signInRequired', 'Sign in to view messages.')}
      </div>
    )
  }

  return (
    <main className="grid h-screen min-h-0 grid-cols-1 grid-rows-[auto_1fr] bg-background text-foreground sm:grid-cols-[280px_1fr] sm:grid-rows-1">
      <ProfileMessengerChannelList
        channels={channels}
        selectedKey={selectedChannel?.key}
        onlineLogins={onlineLogins}
        onSelect={(channel) => selectChannel(channel.key)}
      />
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="flex min-h-16 items-center gap-3 border-b border-border px-5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted font-semibold">
            {selectedChannel?.kind === 'team' ? (
              <Users className="size-4" />
            ) : (
              selectedChannel?.label.slice(0, 1).toLocaleUpperCase()
            )}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {selectedChannel?.kind === 'team'
                ? translate('samwoo.profileMessages.teamChat', 'Team chat')
                : selectedChannel?.label}
            </h2>
            {onlineLogins ? (
              <p className="text-xs text-status-success">
                {translate('samwoo.profileMessages.onlineCount', 'Online {{count}}', {
                  count: onlineLogins.length
                })}
              </p>
            ) : null}
          </div>
        </header>
        <div
          ref={messageViewportRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-3 scrollbar-sleek"
          onScroll={(event) => {
            const viewport = event.currentTarget
            stickToBottomRef.current =
              viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
          }}
        >
          {hasOlder ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mx-auto flex"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? <Loader2 className="animate-spin" /> : null}
              {translate('samwoo.profileMessages.loadOlder', 'Load earlier messages')}
            </Button>
          ) : null}
          {loading && !messages.length ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="animate-spin" />
            </div>
          ) : (
            <ProfileMessageTimeline messages={messages} onReply={setReplyTo} />
          )}
        </div>
        <ProfileMessageComposer
          draft={draft}
          replyTo={replyTo}
          sending={sending}
          onDraftChange={setDraft}
          onCancelReply={() => setReplyTo(null)}
          onSend={() => void sendMessage()}
        />
      </section>
    </main>
  )
}
