import React, { useState } from 'react'
import { Download, Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import {
  readSharedWorkspaceAlias,
  writeSharedWorkspaceAlias
} from '@/lib/shared-workspace-alias-store'
import { useAppStore } from '@/store'
import type {
  SamwooWorkspacePermission,
  SamwooWorkspaceShare
} from '../../../../shared/samwoo-workspace-sharing'

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
    case 'clone':
      return translate('samwoo.workspaceSharing.permissionClone', 'Local clone')
    case 'contribute':
      return translate('samwoo.workspaceSharing.permissionContribute', 'Contribute with Git access')
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
  const token = useSamwooAuthStore((state) => state.auth?.token)
  const fetchRepos = useAppStore((state) => state.fetchRepos)

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
        <span className="truncate">{share.repositoryUrl}</span>
        <span className="shrink-0">{getSamwooWorkspacePermissionLabel(share.permission)}</span>
      </div>
      <div className="flex justify-end gap-2">
        {share.permission !== 'view' ? (
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
