import React, { useState } from 'react'
import { Loader2, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
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
import {
  readSharedWorkspaceAlias,
  writeSharedWorkspaceAlias
} from '@/lib/shared-workspace-alias-store'
import type {
  SamwooWorkspacePermission,
  SamwooWorkspaceShare
} from '../../../../shared/samwoo-workspace-sharing'
import SharedWorkspaceComments from './SharedWorkspaceComments'
import SharedWorkspaceConflictDialog from './SharedWorkspaceConflictDialog'
import SharedWorkspaceSyncPreviewDialog from './SharedWorkspaceSyncPreviewDialog'
import { useSharedWorkspaceSync } from './use-shared-workspace-sync'
import { useAppStore } from '@/store'

type Props = {
  share: SamwooWorkspaceShare
  login: string
  busy: boolean
  onRefresh: () => Promise<void>
}

export function getSamwooWorkspacePermissionLabel(permission: SamwooWorkspacePermission): string {
  switch (permission) {
    case 'view':
      return translate('samwoo.workspaceSharing.permissionView', 'List only')
    case 'download':
      return translate('samwoo.workspaceSharing.permissionDownload', 'Local copy')
    case 'contribute':
      return translate('samwoo.workspaceSharing.permissionContribute', 'Can contribute')
  }
}

export default function SharedWorkspaceShareCard({
  share,
  login,
  busy,
  onRefresh
}: Props): React.JSX.Element {
  const [name, setName] = useState(share.displayName)
  const [alias, setAlias] = useState(() => readSharedWorkspaceAlias(login, share.id))
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const token = useSamwooAuthStore((state) => state.auth?.token)
  const workspaceStatuses = useAppStore((state) => state.workspaceStatuses)
  const localName = alias.trim() || share.displayName
  const sync = useSharedWorkspaceSync({ share, login, localName, onRefresh })
  const hasCentralBoardStatus = typeof share.boardStatus === 'string'
  const canUpdateStatus =
    hasCentralBoardStatus && (share.isOwner || share.permission === 'contribute')
  const boardStatus = share.boardStatus ?? 'todo'
  const hasLocalBoardStatus = workspaceStatuses.some((status) => status.id === boardStatus)

  const updateBoardStatus = async (status: string): Promise<void> => {
    if (!token || !canUpdateStatus || status === boardStatus) {
      return
    }
    setUpdatingStatus(true)
    let result
    try {
      result = await window.api.preflight.samwooWorkspaceShares.updateBoardStatus({
        token,
        shareId: share.id,
        status
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'samwoo.workspaceSharing.statusUpdateFailed',
              'Could not update the shared workspace status.'
            )
      )
      return
    } finally {
      setUpdatingStatus(false)
    }
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
  }

  const saveName = async (): Promise<void> => {
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

  const revoke = async (): Promise<void> => {
    if (!token) {
      return
    }
    const result = await window.api.preflight.samwooWorkspaceShares.revoke({ token, id: share.id })
    if (!result.ok) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.revokeFailed', 'Could not revoke the share.')
      )
      return
    }
    toast.success(translate('samwoo.workspaceSharing.revoked', 'Central share revoked.'))
    await onRefresh()
  }

  return (
    <>
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Input
            value={share.isOwner ? name : alias}
            placeholder={
              share.isOwner
                ? translate('samwoo.workspaceSharing.sharedName', 'Shared name')
                : share.displayName
            }
            aria-label={
              share.isOwner
                ? translate('samwoo.workspaceSharing.sharedName', 'Shared name')
                : translate('samwoo.workspaceSharing.localAlias', 'My local alias')
            }
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
              size="icon-sm"
              variant="outline"
              aria-label={translate('samwoo.workspaceSharing.saveSharedName', 'Save shared name')}
              onClick={saveName}
            >
              <Pencil />
            </Button>
          ) : null}
        </div>
        {!share.isOwner && alias ? (
          <p className="text-xs text-muted-foreground">
            {translate('samwoo.workspaceSharing.centralName', 'Central name: {{name}}', {
              name: share.displayName
            })}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="truncate">
            {translate('samwoo.workspaceSharing.profileCloud', 'Hermes profile cloud')}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {sync.hasRemoteChanges ? (
              <Badge variant="secondary">
                {translate('samwoo.workspaceSharing.newChanges', 'New changes')}
              </Badge>
            ) : null}
            {getSamwooWorkspacePermissionLabel(share.permission)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium">
              {translate('samwoo.workspaceSharing.boardStatus', 'Board status')}
            </p>
            {share.boardStatusUpdatedBy ? (
              <p className="truncate text-[11px] text-muted-foreground">
                {translate(
                  'samwoo.workspaceSharing.boardStatusAudit',
                  'Updated by {{name}} · {{time}}',
                  {
                    name: share.boardStatusUpdatedBy,
                    time: new Date(share.boardStatusUpdatedAt ?? 0).toLocaleString()
                  }
                )}
              </p>
            ) : null}
          </div>
          <Select
            value={boardStatus}
            disabled={busy || updatingStatus || !canUpdateStatus}
            onValueChange={(status) => void updateBoardStatus(status)}
          >
            <SelectTrigger className="w-40">
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
        </div>
        {token ? (
          <SharedWorkspaceComments
            shareId={share.id}
            token={token}
            initialCount={share.commentCount ?? 0}
          />
        ) : null}
        <div className="flex justify-end gap-2">
          {share.permission !== 'view' || share.isOwner ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || sync.syncing !== null}
              onClick={() => void sync.preview('pull')}
            >
              {sync.syncing === 'pull' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {sync.syncing === 'pull'
                ? translate('samwoo.workspaceSharing.downloading', 'Getting changes…')
                : sync.localPath
                  ? translate('samwoo.workspaceSharing.pullChanges', 'Get changes')
                  : translate('samwoo.workspaceSharing.downloadLocal', 'Download locally')}
            </Button>
          ) : null}
          {sync.localPath && (share.isOwner || share.permission === 'contribute') ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || sync.syncing !== null}
              onClick={() => void sync.preview('push')}
            >
              {sync.syncing === 'push' ? <Loader2 className="animate-spin" /> : <Upload />}
              {sync.syncing === 'push'
                ? translate('samwoo.workspaceSharing.uploading', 'Uploading…')
                : translate('samwoo.workspaceSharing.pushChanges', 'Upload changes')}
            </Button>
          ) : null}
          {share.isOwner ? (
            <Button size="sm" variant="destructive" disabled={busy} onClick={revoke}>
              <Trash2 /> {translate('samwoo.workspaceSharing.revoke', 'Revoke share')}
            </Button>
          ) : null}
        </div>
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
    </>
  )
}
