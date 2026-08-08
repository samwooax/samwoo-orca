import React from 'react'
import { Clock3, Loader2, Reply, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'

export default function ProfileMessageRow({
  message,
  startsGroup,
  online,
  onReply,
  onRetry
}: {
  message: SamwooProfileMessage
  startsGroup: boolean
  online: boolean
  onReply: (message: SamwooProfileMessage) => void
  onRetry: (clientMessageId: string) => void
}): React.JSX.Element {
  const time = formatMessageTime(message.createdAt)
  return (
    <div
      className={`group flex gap-2 ${message.isAuthor ? 'justify-end' : 'justify-start'} ${startsGroup ? 'mt-4' : 'mt-1'}`}
    >
      {!message.isAuthor ? (
        <div className="w-[30px] shrink-0">
          {startsGroup ? (
            <span className="relative flex size-[30px] items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {message.authorLogin.slice(0, 1).toLocaleUpperCase()}
              {online ? (
                <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-status-success" />
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="max-w-[78%]">
        {!message.isAuthor && startsGroup ? (
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium">{message.authorLogin}</span>
            {online ? <span className="size-2 rounded-full bg-status-success" /> : null}
            <span className="text-[11px] text-muted-foreground">{time}</span>
          </div>
        ) : null}
        <div className={`flex items-center gap-1 ${message.isAuthor ? 'justify-end' : ''}`}>
          {!message.deliveryState ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className={`opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${message.isAuthor ? 'order-first' : 'order-last'}`}
              aria-label={translate('samwoo.profileMessages.reply', 'Reply')}
              onClick={() => onReply(message)}
            >
              <Reply />
            </Button>
          ) : null}
          <div
            className={`rounded-lg border border-border px-3 py-2 text-sm ${message.deliveryState ? 'rounded-tr-sm bg-muted/60 text-muted-foreground' : message.isAuthor ? 'rounded-tr-sm bg-accent text-accent-foreground' : 'rounded-tl-sm bg-muted/60'}`}
          >
            {message.replyToId ? (
              <div className="mb-2 border-l-2 border-current/30 pl-2 text-xs opacity-75">
                <span className="font-medium">{message.replyToAuthor}</span>
                <p className="truncate">{message.replyToPreview}</p>
              </div>
            ) : null}
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          </div>
        </div>
        {message.isAuthor ? (
          <div className="mt-1 flex justify-end gap-1 text-[11px] text-muted-foreground">
            {message.deliveryState === 'pending' ? (
              <span className="flex items-center gap-1">
                <Clock3 className="size-3" />
                {translate('samwoo.profileMessages.pending', 'Sending')}
              </span>
            ) : null}
            {message.deliveryState === 'retrying' ? (
              <span className="flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" />
                {translate('samwoo.profileMessages.retrying', 'Retrying')}
              </span>
            ) : null}
            {message.deliveryState === 'failed' && message.clientMessageId ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-auto px-1 py-0 text-destructive"
                onClick={() => onRetry(message.clientMessageId!)}
              >
                <RotateCcw className="size-3" />
                {translate('samwoo.profileMessages.retrySend', 'Resend')}
              </Button>
            ) : null}
            <span>{time}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function mergeProfileMessages(
  current: SamwooProfileMessage[],
  incoming: SamwooProfileMessage[]
): SamwooProfileMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) {
    byId.set(message.id, message)
  }
  return [...byId.values()].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  )
}

function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}
