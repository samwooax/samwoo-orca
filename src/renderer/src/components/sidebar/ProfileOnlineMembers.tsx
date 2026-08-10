import React, { useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { profileMemberDisplayName } from '@/lib/profile-member-display'

export default function ProfileOnlineMembers({
  onlineLogins,
  memberNames
}: {
  onlineLogins: ReadonlySet<string>
  memberNames: ReadonlyMap<string, string>
}): React.JSX.Element {
  const names = useMemo(
    () =>
      [...onlineLogins]
        .map((login) => profileMemberDisplayName(login, undefined, memberNames))
        .sort((left, right) => left.localeCompare(right)),
    [memberNames, onlineLogins]
  )
  const countLabel = translate('samwoo.profileMessages.onlineCount', 'Online {{count}}', {
    count: onlineLogins.size
  })
  const detailLabel = translate(
    'samwoo.profileMessages.onlineMembers',
    'Online members: {{names}}',
    { names: names.join(', ') }
  )
  const visibleLabel = names.length ? `${countLabel} · ${names.join(', ')}` : countLabel

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="flex min-w-0 max-w-full items-center gap-1.5 text-[11px] text-muted-foreground"
          aria-label={detailLabel}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-status-success" />
          <span className="truncate">{visibleLabel}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-72">
        {detailLabel}
      </TooltipContent>
    </Tooltip>
  )
}
