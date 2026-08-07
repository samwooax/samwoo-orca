import React from 'react'
import { Reply } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'

export default function ProfileMessageRow({
  message,
  onReply
}: {
  message: SamwooProfileMessage
  onReply: (message: SamwooProfileMessage) => void
}): React.JSX.Element {
  return (
    <div className={`group flex ${message.isAuthor ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[78%]">
        <div className={`mb-1 flex items-center gap-2 ${message.isAuthor ? 'justify-end' : ''}`}>
          <span className="text-[11px] font-medium text-muted-foreground">
            {message.authorLogin}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatMessageTime(message.createdAt)}
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={translate('samwoo.profileMessages.reply', 'Reply')}
            onClick={() => onReply(message)}
          >
            <Reply />
          </Button>
        </div>
        <div
          className={`rounded-lg border border-border px-3 py-2 text-sm ${message.isAuthor ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground'}`}
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
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}
