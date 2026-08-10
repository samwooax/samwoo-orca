import { useEffect, useState } from 'react'
import { Loader2, MessageCircle, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'
import {
  readSharedWorkspaceAlias,
  writeSharedWorkspaceAlias
} from '@/lib/shared-workspace-alias-store'
import { useAppStore } from '@/store'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import type { SamwooProfileMember } from '../../../../shared/samwoo-profile-members'
import SharedWorkspaceComments from '../sidebar/SharedWorkspaceComments'
import SharedWorkspaceConflictDialog from '../sidebar/SharedWorkspaceConflictDialog'
import SharedWorkspaceSyncPreviewDialog from '../sidebar/SharedWorkspaceSyncPreviewDialog'
import { useSharedWorkspaceSync } from '../sidebar/use-shared-workspace-sync'
import {
  getSamwooWorkspacePermissionLabel,
  getSharedWorkspaceDisplayName,
  getSharedWorkspaceInitial
} from './shared-workspace-presentation'
import WorkspaceAssigneePicker from './WorkspaceAssigneePicker'
import WorkspaceDetailAuditLine from './WorkspaceDetailAuditLine'
import SharedWorkspaceWorkItems from './SharedWorkspaceWorkItems'

type Props = {
  share: SamwooWorkspaceShare
  login: string
  busy: boolean
  focusNameEditor: boolean
  members: readonly SamwooProfileMember[]
  updatingAssignees: boolean
  onUpdateAssignees: (logins: string[]) => Promise<boolean>
  updatingDueDate: boolean
  onUpdateDueDate: (dueDate: string | null) => Promise<boolean>
  onRefresh: () => Promise<void>
  onRevoke: () => Promise<boolean>
  onClose: () => void
}

export default function SharedWorkspaceDetails({
  share,
  login,
  busy,
  focusNameEditor,
  members,
  updatingAssignees,
  onUpdateAssignees,
  updatingDueDate,
  onUpdateDueDate,
  onRefresh,
  onRevoke,
  onClose
}: Props): React.JSX.Element {
  const [name, setName] = useState(share.displayName)
  const [alias, setAlias] = useState(() => readSharedWorkspaceAlias(login, share.id))
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const token = useSamwooAuthStore((state) => state.auth?.token)
  const openMessenger = useSamwooMessageInboxStore((state) => state.openMessenger)
  const workspaceStatuses = useAppStore((state) => state.workspaceStatuses)
  const localName = alias.trim() || share.displayName
  const sync = useSharedWorkspaceSync({ share, login, localName, onRefresh })
  const boardStatus = share.boardStatus ?? 'todo'
  const canUpdateStatus =
    typeof share.boardStatus === 'string' && (share.isOwner || share.permission === 'contribute')
  const hasLocalBoardStatus = workspaceStatuses.some((status) => status.id === boardStatus)

  useEffect(() => setName(share.displayName), [share.displayName])
  useEffect(() => setAlias(readSharedWorkspaceAlias(login, share.id)), [login, share.id])

  const updateBoardStatus = async (status: string): Promise<void> => {
    if (!token || !canUpdateStatus || status === boardStatus) {
      return
    }
    setUpdatingStatus(true)
    try {
      const result = await window.api.preflight.samwooWorkspaceShares.updateBoardStatus({
        token,
        shareId: share.id,
        status
      })
      if (!result.ok) {
        toast.error(
          result.error ??
            translate(
              'samwoo.workspaceSharing.statusUpdateFailed',
              'Could not update the shared workspace status.'
            )
        )
        return
      }
      await onRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'samwoo.workspaceSharing.statusUpdateFailed',
              'Could not update the shared workspace status.'
            )
      )
    } finally {
      setUpdatingStatus(false)
    }
  }

  const saveName = async (): Promise<void> => {
    if (!share.isOwner) {
      writeSharedWorkspaceAlias(login, share.id, alias)
      return
    }
    if (!token || !name.trim()) {
      return
    }
    const result = await window.api.preflight.samwooWorkspaceShares.update({
      token,
      id: share.id,
      displayName: name.trim(),
      description: share.description ?? undefined,
      permission: share.permission
    })
    if (!result.ok) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.saveNameFailed', 'Could not save the shared name.')
      )
      return
    }
    toast.success(translate('samwoo.workspaceSharing.nameSaved', 'Shared name saved.'))
    await onRefresh()
  }

  const displayName = getSharedWorkspaceDisplayName(share, login)
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-foreground/80">
          {getSharedWorkspaceInitial(displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xs font-medium">{displayName}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {getSamwooWorkspacePermissionLabel(share.permission)} ·{' '}
            {translate('samwoo.workspaceSharing.profileCloud', 'Hermes profile cloud')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('samwoo.workspaceHub.closeDetails', 'Close details')}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 scrollbar-sleek">
        <Button
          size="xs"
          variant="outline"
          className="w-full justify-start"
          onClick={() => openMessenger(`workspace:${share.id}`)}
        >
          <MessageCircle />
          {translate('samwoo.workspaceHub.openChannel', 'Open channel')}
        </Button>

        <div className="divide-y divide-border border-y border-border">
          <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 py-2">
            <p className="pt-1 text-[11px] text-muted-foreground">
              {translate('samwoo.workspaceHub.assignees', 'Assignees')}
            </p>
            <div className="min-w-0">
              <WorkspaceAssigneePicker
                members={members}
                selectedLogins={share.assigneeLogins ?? []}
                ownLogin={login}
                canEdit={share.isOwner || share.permission === 'contribute'}
                updating={updatingAssignees}
                onChange={(logins) => void onUpdateAssignees(logins)}
              />
              <WorkspaceDetailAuditLine
                kind="assignee"
                name={share.assigneesUpdatedBy}
                updatedAt={share.assigneesUpdatedAt}
              />
            </div>
          </div>

          <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 py-2">
            <p className="pt-1.5 text-[11px] text-muted-foreground">
              {translate('samwoo.workspaceHub.dueDate', 'Due date')}
            </p>
            <div className="min-w-0">
              <Input
                className="h-7 px-2 text-xs shadow-none"
                type="date"
                value={share.dueDate ?? ''}
                disabled={
                  busy || updatingDueDate || (!share.isOwner && share.permission !== 'contribute')
                }
                onChange={(event) => void onUpdateDueDate(event.target.value || null)}
              />
              <WorkspaceDetailAuditLine
                kind="dueDate"
                name={share.dueDateUpdatedBy}
                updatedAt={share.dueDateUpdatedAt}
              />
            </div>
          </div>

          <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 py-2">
            <p className="pt-1.5 text-[11px] text-muted-foreground">
              {share.isOwner
                ? translate('samwoo.workspaceSharing.sharedName', 'Shared name')
                : translate('samwoo.workspaceSharing.localAlias', 'My local alias')}
            </p>
            <div className="min-w-0">
              <div className="flex gap-1">
                <Input
                  className="h-7 px-2 text-xs shadow-none"
                  autoFocus={focusNameEditor}
                  value={share.isOwner ? name : alias}
                  placeholder={share.isOwner ? undefined : share.displayName}
                  onChange={(event) => {
                    if (share.isOwner) {
                      setName(event.target.value)
                    } else {
                      setAlias(event.target.value)
                      writeSharedWorkspaceAlias(login, share.id, event.target.value)
                    }
                  }}
                />
                {share.isOwner ? (
                  <Button
                    size="icon-xs"
                    variant="outline"
                    aria-label={translate(
                      'samwoo.workspaceSharing.saveSharedName',
                      'Save shared name'
                    )}
                    onClick={() => void saveName()}
                  >
                    <Pencil />
                  </Button>
                ) : null}
              </div>
              {!share.isOwner && alias ? (
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {translate('samwoo.workspaceSharing.centralName', 'Central name: {{name}}', {
                    name: share.displayName
                  })}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 py-2">
            <p className="pt-1.5 text-[11px] text-muted-foreground">
              {translate('samwoo.workspaceSharing.boardStatus', 'Board status')}
            </p>
            <div className="min-w-0">
              <Select
                value={boardStatus}
                disabled={busy || updatingStatus || !canUpdateStatus}
                onValueChange={(status) => void updateBoardStatus(status)}
              >
                <SelectTrigger size="sm" className="h-7 w-full px-2 text-xs shadow-none">
                  {updatingStatus ? <Loader2 className="animate-spin" /> : null}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!hasLocalBoardStatus ? (
                    <SelectItem value={boardStatus}>{boardStatus}</SelectItem>
                  ) : null}
                  {workspaceStatuses.map((status) => (
                    <SelectItem key={status.id} value={status.id}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <WorkspaceDetailAuditLine
                kind="boardStatus"
                name={share.boardStatusUpdatedBy}
                updatedAt={share.boardStatusUpdatedAt}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-1.5">
          {share.permission !== 'view' || share.isOwner ? (
            <Button
              size="xs"
              variant="outline"
              className="min-w-0 flex-1"
              disabled={busy || sync.syncing !== null}
              onClick={() => void sync.preview('pull')}
            >
              {sync.syncing === 'pull' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              <span className="truncate">
                {sync.syncing === 'pull'
                  ? translate('samwoo.workspaceSharing.downloading', 'Getting changes…')
                  : sync.localPath
                    ? translate('samwoo.workspaceSharing.pullChanges', 'Get changes')
                    : translate('samwoo.workspaceSharing.downloadLocal', 'Download locally')}
              </span>
            </Button>
          ) : null}
          {sync.localPath && (share.isOwner || share.permission === 'contribute') ? (
            <Button
              size="xs"
              variant="outline"
              className="min-w-0 flex-1"
              disabled={busy || sync.syncing !== null}
              onClick={() => void sync.preview('push')}
            >
              {sync.syncing === 'push' ? <Loader2 className="animate-spin" /> : <Upload />}
              <span className="truncate">
                {sync.syncing === 'push'
                  ? translate('samwoo.workspaceSharing.uploading', 'Uploading…')
                  : translate('samwoo.workspaceSharing.pushChanges', 'Upload changes')}
              </span>
            </Button>
          ) : null}
        </div>

        {sync.hasRemoteChanges ? (
          <Badge variant="secondary" className="text-[11px]">
            {translate('samwoo.workspaceSharing.newChanges', 'New changes')}
          </Badge>
        ) : null}
        {token ? (
          <SharedWorkspaceWorkItems
            shareId={share.id}
            token={token}
            ownLogin={login}
            canEdit={share.isOwner || share.permission === 'contribute'}
            members={members}
            onSummaryRefresh={onRefresh}
          />
        ) : null}
        {token ? (
          <SharedWorkspaceComments
            shareId={share.id}
            token={token}
            initialCount={share.commentCount ?? 0}
          />
        ) : null}
        {share.isOwner ? (
          <Button
            variant="destructive"
            size="xs"
            disabled={busy}
            onClick={() => {
              void onRevoke().then((revoked) => {
                if (revoked) {
                  onClose()
                }
              })
            }}
          >
            <Trash2 /> {translate('samwoo.workspaceSharing.revoke', 'Revoke share')}
          </Button>
        ) : null}
      </div>
      <SharedWorkspaceSyncPreviewDialog
        open={Boolean(sync.pending)}
        direction={sync.pending?.direction ?? 'pull'}
        preview={sync.pending?.preview ?? null}
        busy={sync.syncing !== null}
        onOpenChange={(open) => {
          if (!open) {
            sync.setPending(null)
          }
        }}
        onConfirm={(deletePaths) => void sync.confirm(deletePaths)}
      />
      <SharedWorkspaceConflictDialog
        open={Boolean(sync.conflicts.length)}
        paths={sync.conflicts}
        canWrite={sync.canWrite}
        busy={sync.syncing === 'resolve'}
        onOpenChange={(open) => {
          if (!open) {
            sync.setConflicts([])
          }
        }}
        onResolve={(choices) => void sync.resolve(choices)}
      />
    </div>
  )
}
