import { MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { profileMemberDisplayName, profileMemberNameMap } from '@/lib/profile-member-display'
import { cn } from '@/lib/utils'
import type { WorkspaceStatusDefinition } from '../../../../shared/types'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import type { SamwooProfileMember } from '../../../../shared/samwoo-profile-members'
import { getWorkspaceStatusVisualMeta } from '../sidebar/workspace-status'
import WorkspaceHubBoardView from './WorkspaceHubBoardView'
import WorkspaceAssigneePicker from './WorkspaceAssigneePicker'
import { formatWorkspaceDueDate, isWorkspaceDueDateOverdue } from './workspace-due-date'
import {
  formatSharedWorkspaceUpdatedAt,
  getSamwooWorkspacePermissionLabel,
  getSharedWorkspaceDisplayName,
  getSharedWorkspaceInitial,
  hasSharedWorkspaceRemoteChanges
} from './shared-workspace-presentation'

type Props = {
  mode: 'list' | 'board'
  shares: SamwooWorkspaceShare[]
  login: string
  statuses: readonly WorkspaceStatusDefinition[]
  selectedShareId: string | null
  onSelect: (shareId: string) => void
  onEditName: (shareId: string) => void
  onRevoke: (shareId: string) => void
  updatingShareId: string | null
  onMoveStatus: (shareId: string, status: string) => void
  members: readonly SamwooProfileMember[]
  updatingAssigneeShareId: string | null
  onUpdateAssignees: (shareId: string, logins: string[]) => void
}

function WorkspaceStatusPill({
  share,
  statuses
}: {
  share: SamwooWorkspaceShare
  statuses: readonly WorkspaceStatusDefinition[]
}): React.JSX.Element {
  const status = statuses.find((item) => item.id === (share.boardStatus ?? 'todo'))
  const visual = getWorkspaceStatusVisualMeta(status ?? share.boardStatus ?? 'todo')
  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <span className={cn('size-1.5 rounded-full', visual.swatch)} />
      {status?.label ?? share.boardStatus ?? 'todo'}
    </Badge>
  )
}

function WorkspaceInitialTile({ name }: { name: string }): React.JSX.Element {
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-foreground/80">
      {getSharedWorkspaceInitial(name)}
    </span>
  )
}

function WorkspaceListRow({
  share,
  login,
  statuses,
  selected,
  onSelect,
  onEditName,
  onRevoke,
  members,
  updatingAssigneeShareId,
  onUpdateAssignees
}: Omit<Props, 'mode' | 'shares' | 'selectedShareId' | 'updatingShareId' | 'onMoveStatus'> & {
  share: SamwooWorkspaceShare
  selected: boolean
}): React.JSX.Element {
  const name = getSharedWorkspaceDisplayName(share, login)
  const memberNames = profileMemberNameMap(members)
  return (
    <div
      role="button"
      tabIndex={0}
      data-current={selected}
      className="grid min-h-16 cursor-pointer grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-3 border-b border-border/50 px-6 text-left hover:bg-accent/50 data-[current=true]:bg-accent/30 sm:grid-cols-[minmax(0,1fr)_110px_110px_90px_100px_120px_32px]"
      onClick={() => onSelect(share.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(share.id)
        }
      }}
    >
      <span className="flex min-w-0 items-center gap-3">
        <WorkspaceInitialTile name={name} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            {hasSharedWorkspaceRemoteChanges(share, login) ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-status-success"
                aria-label={translate('samwoo.workspaceSharing.newChanges', 'New changes')}
              />
            ) : null}
          </span>
          {!share.isOwner && name !== share.displayName ? (
            <span className="block truncate text-[11px] text-muted-foreground">
              {translate('samwoo.workspaceSharing.centralName', 'Central name: {{name}}', {
                name: share.displayName
              })}
            </span>
          ) : null}
          <span className="block truncate text-[11px] text-muted-foreground">
            {translate(
              'samwoo.workspaceHub.workItemProgress',
              '{{completed}}/{{total}} work items complete',
              {
                completed: share.completedWorkItemCount ?? 0,
                total: share.workItemCount ?? 0
              }
            )}
            {' · '}
            {translate('samwoo.workspaceHub.commentCount', '{{count}} comments', {
              count: share.commentCount ?? 0
            })}
          </span>
        </span>
      </span>
      <span className="hidden sm:block">
        <WorkspaceStatusPill share={share} statuses={statuses} />
      </span>
      <span className="hidden min-w-0 sm:block">
        <WorkspaceAssigneePicker
          members={members}
          selectedLogins={share.assigneeLogins ?? []}
          ownLogin={login}
          canEdit={share.isOwner || share.permission === 'contribute'}
          updating={updatingAssigneeShareId === share.id}
          onChange={(logins) => onUpdateAssignees(share.id, logins)}
        />
      </span>
      <span
        className={cn(
          'hidden text-xs text-muted-foreground sm:block',
          isWorkspaceDueDateOverdue(share.dueDate) && 'text-destructive'
        )}
      >
        {formatWorkspaceDueDate(share.dueDate)}
      </span>
      <span className="hidden text-xs text-muted-foreground sm:block">
        {getSamwooWorkspacePermissionLabel(share.permission)}
      </span>
      <span className="text-xs text-muted-foreground">
        {share.boardStatusUpdatedBy
          ? `${profileMemberDisplayName(share.boardStatusUpdatedBy, undefined, memberNames)} · `
          : ''}
        {formatSharedWorkspaceUpdatedAt(share.boardStatusUpdatedAt ?? share.updatedAt)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate('samwoo.workspaceHub.moreActions', 'More actions')}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEditName(share.id)}>
            {share.isOwner
              ? translate('samwoo.workspaceHub.editName', 'Edit shared name')
              : translate('samwoo.workspaceHub.editAlias', 'Edit local alias')}
          </DropdownMenuItem>
          {share.isOwner ? (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onRevoke(share.id)}
            >
              {translate('samwoo.workspaceSharing.revoke', 'Revoke share')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function WorkspaceListView(props: Omit<Props, 'mode'>): React.JSX.Element {
  return (
    <div className="min-w-[360px]">
      <div className="grid h-10 grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-3 border-b border-border px-6 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_110px_110px_90px_100px_120px_32px]">
        <span>{translate('samwoo.workspaceSharing.columnName', 'Name')}</span>
        <span className="hidden sm:block">
          {translate('samwoo.workspaceSharing.columnStatus', 'Status')}
        </span>
        <span className="hidden sm:block">
          {translate('samwoo.workspaceHub.assignees', 'Assignees')}
        </span>
        <span className="hidden sm:block">
          {translate('samwoo.workspaceHub.dueDate', 'Due date')}
        </span>
        <span className="hidden sm:block">
          {translate('samwoo.workspaceSharing.columnPermission', 'Permission')}
        </span>
        <span>{translate('samwoo.workspaceSharing.columnUpdated', 'Last updated')}</span>
        <span />
      </div>
      {props.shares.map((share) => (
        <WorkspaceListRow
          key={share.id}
          share={share}
          login={props.login}
          statuses={props.statuses}
          selected={share.id === props.selectedShareId}
          onSelect={props.onSelect}
          onEditName={props.onEditName}
          onRevoke={props.onRevoke}
          members={props.members}
          updatingAssigneeShareId={props.updatingAssigneeShareId}
          onUpdateAssignees={props.onUpdateAssignees}
        />
      ))}
    </div>
  )
}

export default function WorkspaceHubViews({ mode, ...props }: Props): React.JSX.Element {
  if (!props.shares.length) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {translate('samwoo.workspaceSharing.empty', 'There are no shared workspaces.')}
      </div>
    )
  }
  return mode === 'list' ? (
    <WorkspaceListView {...props} />
  ) : (
    <WorkspaceHubBoardView
      shares={props.shares}
      login={props.login}
      statuses={props.statuses}
      selectedShareId={props.selectedShareId}
      updatingShareId={props.updatingShareId}
      onSelect={props.onSelect}
      onMoveStatus={props.onMoveStatus}
    />
  )
}
