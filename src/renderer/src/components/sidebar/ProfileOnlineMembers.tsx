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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="text-xs text-status-success" aria-label={detailLabel}>
          {countLabel}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-72">
        {detailLabel}
      </TooltipContent>
    </Tooltip>
  )
}
