import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hash, Loader2, MessageCircle, Reply, Send, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { isSamwooSessionError } from '@/lib/samwoo-session-validation'
import type {
  SamwooProfileMessage,
  SamwooProfileMessageChannel
} from '../../../../shared/samwoo-profile-messaging'
import ProfileMessageRow, { mergeProfileMessages } from './ProfileMessageRow'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUnreadCountChange: (count: number) => void
}

const OPEN_REFRESH_MS = 3_000
const CLOSED_REFRESH_MS = 30_000

export default function ProfileMessagesDialog({
  open,
  onOpenChange,
  onUnreadCountChange
}: Props): React.JSX.Element {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)
  const [channels, setChannels] = useState<SamwooProfileMessageChannel[]>([])
  const [selectedKey, setSelectedKey] = useState('team')
  const [messages, setMessages] = useState<SamwooProfileMessage[]>([])
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<SamwooProfileMessage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const requestSequence = useRef(0)
  const messageViewportRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.key === selectedKey) ?? channels[0],
    [channels, selectedKey]
  )
  const selectedChannelKey = selectedChannel?.key
  const selectedChannelKind = selectedChannel?.kind
  const selectedShareId = selectedChannel?.shareId ?? undefined

  const handleError = useCallback(
    (error: string | undefined, fallback: string): void => {
      if (isSamwooSessionError(error)) {
        toast.error(
          translate(
            'samwoo.profileMessages.sessionExpired',
            'Your session has expired. Sign in again.'
          )
        )
        void logout()
        return
      }
      toast.error(error ?? fallback)
    },
    [logout]
  )

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
      if (!nextChannels.some((channel) => channel.key === selectedKey)) {
        setSelectedKey(nextChannels[0]?.key ?? 'team')
      }
      onUnreadCountChange(nextChannels.reduce((total, channel) => total + channel.unreadCount, 0))
    },
    [auth?.token, handleError, onUnreadCountChange, selectedKey]
  )

  const refreshMessages = useCallback(
    async (showProgress = false): Promise<void> => {
      if (!auth?.token || !selectedChannelKey || !selectedChannelKind || !open) {
        return
      }
      const sequence = ++requestSequence.current
      if (showProgress) {
        setLoading(true)
      }
      const result = await window.api.preflight.samwooProfileMessages.listMessages({
        token: auth.token,
        channelKind: selectedChannelKind,
        shareId: selectedShareId
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
      if (latest) {
        await window.api.preflight.samwooProfileMessages.markRead({
          token: auth.token,
          channelKind: selectedChannelKind,
          shareId: selectedShareId,
          messageId: latest.id
        })
        void refreshChannels(false)
      }
    },
    [
      auth?.token,
      handleError,
      open,
      refreshChannels,
      selectedChannelKey,
      selectedChannelKind,
      selectedShareId
    ]
  )

  useEffect(() => {
    void refreshChannels(open)
    const interval = window.setInterval(
      () => void refreshChannels(false),
      open ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS
    )
    return () => window.clearInterval(interval)
  }, [open, refreshChannels])

  useEffect(() => {
    if (!open || !selectedChannelKey || !selectedChannelKind) {
      return
    }
    setMessages([])
    setReplyTo(null)
    stickToBottomRef.current = true
    void refreshMessages(true)
    const interval = window.setInterval(() => void refreshMessages(false), OPEN_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [open, refreshMessages, selectedChannelKey, selectedChannelKind])

  useEffect(() => {
    if (!open) {
      return
    }
    if (!stickToBottomRef.current) {
      return
    }
    messageViewportRef.current?.scrollTo({
      top: messageViewportRef.current.scrollHeight,
      behavior: 'smooth'
    })
  }, [messages, open])

  const loadOlder = async (): Promise<void> => {
    const oldest = messages[0]
    if (!auth?.token || !selectedChannel || !oldest || loadingOlder) {
      return
    }
    setLoadingOlder(true)
    const result = await window.api.preflight.samwooProfileMessages.listMessages({
      token: auth.token,
      channelKind: selectedChannel.kind,
      shareId: selectedChannel.shareId ?? undefined,
      beforeCreatedAt: oldest.createdAt,
      beforeId: oldest.id
    })
    setLoadingOlder(false)
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
    setSending(true)
    const result = await window.api.preflight.samwooProfileMessages.sendMessage({
      token: auth.token,
      channelKind: selectedChannel.kind,
      shareId: selectedChannel.shareId ?? undefined,
      body,
      replyToId: replyTo?.id
    })
    setSending(false)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(720px,82vh)] max-h-[82vh] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle />
            {translate('samwoo.profileMessages.title', 'Messages')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'samwoo.profileMessages.description',
              'Conversations are visible only to members of the connected Hermes profile.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr]">
          <nav className="overflow-y-auto border-r border-border bg-muted/30 p-2 scrollbar-sleek">
            {channels.map((channel) => (
              <button
                key={channel.key}
                type="button"
                data-current={channel.key === selectedChannel?.key}
                className="mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent data-[current=true]:bg-accent"
                onClick={() => setSelectedKey(channel.key)}
              >
                {channel.kind === 'team' ? (
                  <Users className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Hash className="mt-0.5 size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {channel.kind === 'team'
                      ? translate('samwoo.profileMessages.teamChat', 'Team chat')
                      : channel.label}
                  </span>
                  {channel.lastMessagePreview ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {channel.lastMessageAuthor}: {channel.lastMessagePreview}
                    </span>
                  ) : null}
                </span>
                {channel.unreadCount ? (
                  <Badge className="h-5 min-w-5 px-1.5 text-[10px]">{channel.unreadCount}</Badge>
                ) : null}
              </button>
            ))}
          </nav>
          <section className="flex min-h-0 min-w-0 flex-col">
            <div className="border-b border-border px-4 py-2 text-sm font-medium">
              {selectedChannel?.kind === 'team'
                ? translate('samwoo.profileMessages.teamChat', 'Team chat')
                : selectedChannel?.label}
            </div>
            <div
              ref={messageViewportRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 scrollbar-sleek"
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
              ) : messages.length ? (
                messages.map((message) => (
                  <ProfileMessageRow key={message.id} message={message} onReply={setReplyTo} />
                ))
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <MessageCircle className="size-7" />
                  <p className="text-sm">
                    {translate('samwoo.profileMessages.empty', 'No messages yet.')}
                  </p>
                </div>
              )}
            </div>
            <div className="border-t border-border p-3">
              {replyTo ? (
                <div className="mb-2 flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs">
                  <Reply className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">
                    {translate('samwoo.profileMessages.replyingTo', 'Replying to {{name}}', {
                      name: replyTo.authorLogin
                    })}{' '}
                    · {replyTo.body}
                  </span>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={translate('samwoo.profileMessages.cancelReply', 'Cancel reply')}
                    onClick={() => setReplyTo(null)}
                  >
                    <X />
                  </Button>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <Textarea
                  className="min-h-16 resize-none"
                  maxLength={4000}
                  value={draft}
                  placeholder={translate('samwoo.profileMessages.placeholder', 'Write a message…')}
                  aria-label={translate('samwoo.profileMessages.placeholder', 'Write a message')}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendMessage()
                    }
                  }}
                />
                <Button
                  type="button"
                  disabled={!draft.trim() || sending}
                  onClick={() => void sendMessage()}
                >
                  {sending ? <Loader2 className="animate-spin" /> : <Send />}
                  {translate('samwoo.profileMessages.send', 'Send')}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
