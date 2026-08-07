import React from 'react'
import { Loader2, Reply, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'
import { shouldSubmitProfileMessageKey } from './profile-message-interaction-admission'

type Props = {
  draft: string
  replyTo: SamwooProfileMessage | null
  sending: boolean
  onDraftChange: (draft: string) => void
  onCancelReply: () => void
  onSend: () => void
}

export default function ProfileMessageComposer({
  draft,
  replyTo,
  sending,
  onDraftChange,
  onCancelReply,
  onSend
}: Props): React.JSX.Element {
  return (
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
            onClick={onCancelReply}
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
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              shouldSubmitProfileMessageKey({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing
              })
            ) {
              event.preventDefault()
              onSend()
            }
          }}
        />
        <Button type="button" disabled={!draft.trim() || sending} onClick={onSend}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          {translate('samwoo.profileMessages.send', 'Send')}
        </Button>
      </div>
    </div>
  )
}
