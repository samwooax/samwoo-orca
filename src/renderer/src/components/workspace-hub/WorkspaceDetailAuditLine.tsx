import { translate } from '@/i18n/i18n'

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
  updatedAt
}: {
  kind: keyof typeof AUDIT_COPY
  name?: string | null
  updatedAt?: number | null
}): React.JSX.Element | null {
  if (!name) {
    return null
  }
  const copy = AUDIT_COPY[kind]
  return (
    <p className="mt-1 truncate text-[11px] text-muted-foreground">
      {translate(copy.key, copy.fallback, {
        name,
        time: new Date(updatedAt ?? 0).toLocaleString()
      })}
    </p>
  )
}
