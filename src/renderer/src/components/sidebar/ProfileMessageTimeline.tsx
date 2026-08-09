import React from 'react'
import { MessageCircle } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { SamwooProfileMessage } from '../../../../shared/samwoo-profile-messaging'
import ProfileMessageRow from './ProfileMessageRow'
import { formatProfileMessageDate, getProfileMessageGrouping } from './profile-message-grouping'

function DateSeparator({ timestamp }: { timestamp: number }): React.JSX.Element {
  const date = formatProfileMessageDate(timestamp)
  const label =
    date === 'today'
      ? translate('samwoo.profileMessages.today', 'Today')
      : date === 'yesterday'
        ? translate('samwoo.profileMessages.yesterday', 'Yesterday')
        : date
  return (
    <div className="my-5 flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

export default function ProfileMessageTimeline({
  messages,
  onlineLogins,
  memberNames,
  onReply,
  onRetry
}: {
  messages: SamwooProfileMessage[]
  onlineLogins?: ReadonlySet<string>
  memberNames: ReadonlyMap<string, string>
  onReply: (message: SamwooProfileMessage) => void
  onRetry: (clientMessageId: string) => void
}): React.JSX.Element {
  if (!messages.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <MessageCircle className="size-7" />
        <p className="text-sm">{translate('samwoo.profileMessages.empty', 'No messages yet.')}</p>
      </div>
    )
  }

  return (
    <>
      {messages.map((message, index) => {
        const grouping = getProfileMessageGrouping(messages[index - 1], message)
        return (
          <React.Fragment key={message.id}>
            {grouping.startsDate ? <DateSeparator timestamp={message.createdAt} /> : null}
            <ProfileMessageRow
              message={message}
              startsGroup={grouping.startsGroup}
              online={Boolean(onlineLogins?.has(message.authorLogin))}
              memberNames={memberNames}
              onReply={onReply}
              onRetry={onRetry}
            />
          </React.Fragment>
        )
      })}
    </>
  )
}
