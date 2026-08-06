import React, { useState } from 'react'
import { Download, Loader2, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import {
  readSharedWorkspaceAlias,
  writeSharedWorkspaceAlias
} from '@/lib/shared-workspace-alias-store'
import {
  readSharedWorkspaceLocalPath,
  writeSharedWorkspaceLocalPath
} from '@/lib/shared-workspace-local-path-store'
import { useAppStore } from '@/store'
import type {
  SamwooWorkspacePermission,
  SamwooWorkspaceShare
} from '../../../../shared/samwoo-workspace-sharing'
import SharedWorkspaceComments from './SharedWorkspaceComments'

type Props = {
  share: SamwooWorkspaceShare
  login: string
  busy: boolean
  onRefresh: () => Promise<void>
}

function conflictDescription(paths: string[]): string {
  const visiblePaths = paths.slice(0, 5).join('\n')
  const remaining = paths.length - 5
  return remaining > 0 ? `${visiblePaths}\n+${remaining}` : visiblePaths
}

export function getSamwooWorkspacePermissionLabel(permission: SamwooWorkspacePermission): string {
  switch (permission) {
    case 'view':
      return translate('samwoo.workspaceSharing.permissionView', 'List only')
    case 'clone':
      return translate('samwoo.workspaceSharing.permissionClone', 'Local clone')
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
  const [cloneProgress, setCloneProgress] = useState<number | null>(null)
  const [syncing, setSyncing] = useState<'pull' | 'push' | null>(null)
  const [localPath, setLocalPath] = useState(() => readSharedWorkspaceLocalPath(login, share.id))
  const token = useSamwooAuthStore((state) => state.auth?.token)
  const fetchRepos = useAppStore((state) => state.fetchRepos)
  const addNonGitFolder = useAppStore((state) => state.addNonGitFolder)

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

  const clone = async (): Promise<void> => {
    if (share.permission === 'view') {
      return
    }
    const destination = await window.api.repos.pickDirectory()
    if (!destination) {
      return
    }
    const unsubscribe = window.api.repos.onCloneProgress(({ percent }) => setCloneProgress(percent))
    setCloneProgress(0)
    try {
      const repo = await window.api.repos.clone({ url: share.repositoryUrl, destination })
      const localName = alias.trim() || share.displayName
      await window.api.repos.update({ repoId: repo.id, updates: { displayName: localName } })
      await fetchRepos()
      toast.success(
        translate('samwoo.workspaceSharing.cloneComplete', 'Shared workspace cloned locally.'),
        { description: localName }
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('samwoo.workspaceSharing.cloneFailed', 'Could not clone the workspace.')
      )
    } finally {
      unsubscribe()
      setCloneProgress(null)
    }
  }

  const pullNextcloud = async (): Promise<void> => {
    if (!token || (share.permission === 'view' && !share.isOwner)) {
      return
    }
    let pullArgs: { destinationPath: string } | { destinationParent: string; folderName: string }
    if (localPath) {
      pullArgs = { destinationPath: localPath }
    } else {
      const destinationParent = await window.api.repos.pickDirectory()
      if (!destinationParent) {
        return
      }
      pullArgs = { destinationParent, folderName: alias.trim() || share.displayName }
    }
    setSyncing('pull')
    const result = await window.api.preflight.samwooWorkspaceShares.pullFiles({
      token,
      shareId: share.id,
      ...pullArgs
    })
    setSyncing(null)
    if (!result.ok || !result.destinationPath) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.downloadFailed', 'Could not download the workspace.')
      )
      return
    }
    setLocalPath(result.destinationPath)
    writeSharedWorkspaceLocalPath(login, share.id, result.destinationPath)
    if (!localPath) {
      const repo = await addNonGitFolder(result.destinationPath)
      const localName = alias.trim() || share.displayName
      if (repo && repo.displayName !== localName) {
        await window.api.repos.update({ repoId: repo.id, updates: { displayName: localName } })
      }
      await fetchRepos()
    }
    if (result.conflicts?.length) {
      toast.warning(
        translate(
          'samwoo.workspaceSharing.downloadConflicts',
          '{{count}} locally changed files were not overwritten.',
          { count: result.conflicts.length }
        ),
        { description: conflictDescription(result.conflicts) }
      )
      return
    }
    toast.success(
      translate('samwoo.workspaceSharing.downloadComplete', 'Workspace changes checked.'),
      { description: result.destinationPath }
    )
  }

  const pushNextcloud = async (): Promise<void> => {
    if (!token || !localPath || (!share.isOwner && share.permission !== 'contribute')) {
      return
    }
    setSyncing('push')
    const result = await window.api.preflight.samwooWorkspaceShares.pushFiles({
      token,
      shareId: share.id,
      sourcePath: localPath
    })
    setSyncing(null)
    if (!result.ok) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.uploadFailed', 'Could not upload workspace changes.')
      )
      return
    }
    if (result.conflicts?.length) {
      toast.warning(
        translate(
          'samwoo.workspaceSharing.uploadConflicts',
          '{{count}} remotely changed files were not overwritten.',
          { count: result.conflicts.length }
        ),
        { description: conflictDescription(result.conflicts) }
      )
      return
    }
    toast.success(
      translate('samwoo.workspaceSharing.uploadComplete', 'Workspace changes uploaded.'),
      {
        description: translate(
          'samwoo.workspaceSharing.uploadedFileCount',
          '{{count}} files uploaded.',
          { count: result.transferredFiles ?? 0 }
        )
      }
    )
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
          {share.sourceKind === 'nextcloud'
            ? translate('samwoo.workspaceSharing.profileCloud', 'Hermes profile cloud')
            : share.repositoryUrl}
        </span>
        <span className="shrink-0">{getSamwooWorkspacePermissionLabel(share.permission)}</span>
      </div>
      {token ? (
        <SharedWorkspaceComments
          shareId={share.id}
          token={token}
          initialCount={share.commentCount ?? 0}
        />
      ) : null}
      <div className="flex justify-end gap-2">
        {share.sourceKind === 'nextcloud' && (share.permission !== 'view' || share.isOwner) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || syncing !== null}
            onClick={pullNextcloud}
          >
            {syncing === 'pull' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncing === 'pull'
              ? translate('samwoo.workspaceSharing.downloading', 'Getting changes…')
              : localPath
                ? translate('samwoo.workspaceSharing.pullChanges', 'Get changes')
                : translate('samwoo.workspaceSharing.downloadLocal', 'Download locally')}
          </Button>
        ) : null}
        {share.sourceKind === 'nextcloud' &&
        localPath &&
        (share.isOwner || share.permission === 'contribute') ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || syncing !== null}
            onClick={pushNextcloud}
          >
            {syncing === 'push' ? <Loader2 className="animate-spin" /> : <Upload />}
            {syncing === 'push'
              ? translate('samwoo.workspaceSharing.uploading', 'Uploading…')
              : translate('samwoo.workspaceSharing.pushChanges', 'Upload changes')}
          </Button>
        ) : null}
        {share.sourceKind === 'git' && share.permission !== 'view' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || cloneProgress !== null}
            onClick={clone}
          >
            {cloneProgress !== null ? <Loader2 className="animate-spin" /> : <Download />}
            {cloneProgress !== null
              ? translate('samwoo.workspaceSharing.cloning', 'Cloning… {{percent}}%', {
                  percent: Math.round(cloneProgress)
                })
              : translate('samwoo.workspaceSharing.cloneLocal', 'Clone locally')}
          </Button>
        ) : null}
        {share.isOwner ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={revoke}>
            <Trash2 /> {translate('samwoo.workspaceSharing.revoke', 'Revoke share')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
