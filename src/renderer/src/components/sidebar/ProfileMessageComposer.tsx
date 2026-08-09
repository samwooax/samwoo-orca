import React from 'react'
import { ArrowUp, Loader2, Reply, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { profileMemberDisplayName } from '@/lib/profile-member-display'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'
import { shouldSubmitProfileMessageKey } from './profile-message-interaction-admission'

type Props = {
  draft: string
  replyTo: SamwooProfileMessage | null
  sending: boolean
  memberNames: ReadonlyMap<string, string>
  onDraftChange: (draft: string) => void
  onCancelReply: () => void
  onSend: () => void
}

export default function ProfileMessageComposer({
  draft,
  replyTo,
  sending,
  memberNames,
  onDraftChange,
  onCancelReply,
  onSend
}: Props): React.JSX.Element {
  return (
    <div className="border-t border-border p-4">
      {replyTo ? (
        <div className="mb-2 flex items-center gap-2 border-l-2 border-border bg-muted/40 px-3 py-2 text-xs">
          <Reply className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">
            {translate('samwoo.profileMessages.replyingTo', 'Replying to {{name}}', {
              name: profileMemberDisplayName(
                replyTo.authorLogin,
                replyTo.authorDisplayName,
                memberNames
              )
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
      <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/40 p-2 focus-within:ring-2 focus-within:ring-ring/50">
        <Textarea
          className="min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          maxLength={4000}
          value={draft}
          placeholder={translate(
            'samwoo.profileMessages.composerHint',
            'Write a message… (Enter to send · Shift+Enter for a new line)'
          )}
          aria-label={translate('samwoo.profileMessages.placeholder', 'Write a message…')}
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
        <Button
          type="button"
          size="icon"
          className="shrink-0 rounded-full"
          disabled={!draft.trim() || sending}
          aria-label={translate('samwoo.profileMessages.send', 'Send')}
          onClick={onSend}
        >
          {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </div>
    </div>
  )
}
