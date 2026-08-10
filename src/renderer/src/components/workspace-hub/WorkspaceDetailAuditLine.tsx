import { translate } from '@/i18n/i18n'
import { profileMemberDisplayName } from '@/lib/profile-member-display'

const AUDIT_COPY = {
  assignee: {
    key: 'samwoo.workspaceHub.assigneeAudit',
    fallback: 'Assigned by {{name}} · {{time}}'
  },
  dueDate: {
    key: 'samwoo.workspaceHub.dueDateAudit',
    fallback: 'Updated by {{name}} · {{time}}'
  },
  boardStatus: {
    key: 'samwoo.workspaceSharing.boardStatusAudit',
    fallback: 'Updated by {{name}} · {{time}}'
  }
} as const

export default function WorkspaceDetailAuditLine({
  kind,
  name,
  updatedAt,
  memberNames
}: {
  kind: keyof typeof AUDIT_COPY
  name?: string | null
  updatedAt?: number | null
  memberNames: ReadonlyMap<string, string>
}): React.JSX.Element | null {
  if (!name) {
    return null
  }
  const copy = AUDIT_COPY[kind]
  return (
    <p className="mt-1 truncate text-[11px] text-muted-foreground">
      {translate(copy.key, copy.fallback, {
        name: profileMemberDisplayName(name, undefined, memberNames),
        time: new Date(updatedAt ?? 0).toLocaleString()
      })}
    </p>
  )
}
