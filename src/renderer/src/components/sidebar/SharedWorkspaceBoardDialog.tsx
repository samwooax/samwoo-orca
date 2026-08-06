import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/types'
import type {
  SamwooWorkspacePermission,
  SamwooWorkspaceShare
} from '../../../../shared/samwoo-workspace-sharing'
import SharedWorkspaceShareCard, {
  getSamwooWorkspacePermissionLabel
} from './SharedWorkspaceShareCard'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

export default function SharedWorkspaceBoardDialog({
  open,
  onOpenChange
}: Props): React.JSX.Element {
  const auth = useSamwooAuthStore((state) => state.auth)
  const repos = useAppStore((state) => state.repos)
  const shareableRepos = useMemo(
    () =>
      repos
        .filter((repo): repo is Repo => Boolean(repo.gitRemoteIdentity?.remoteUrl))
        .map((repo) => ({
          repo,
          selectionKey: `${repo.id}::${repo.executionHostId ?? repo.connectionId ?? 'local'}::${repo.path}`
        })),
    [repos]
  )
  const [shares, setShares] = useState<SamwooWorkspaceShare[]>([])
  const [repoId, setRepoId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [permission, setPermission] = useState<SamwooWorkspacePermission>('clone')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (!auth?.token) {
      return
    }
    setBusy(true)
    const result = await window.api.preflight.samwooWorkspaceShares.list(auth.token)
    setBusy(false)
    if (result.ok) {
      setShares(result.shares ?? [])
    } else {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.loadFailed', 'Could not load shared workspaces.')
      )
    }
  }, [auth?.token])

  useEffect(() => {
    if (open) {
      void refresh()
    }
  }, [open, refresh])

  const selectedRepo = shareableRepos.find((item) => item.selectionKey === repoId)?.repo
  const create = async (): Promise<void> => {
    if (!auth?.token || !selectedRepo?.gitRemoteIdentity?.remoteUrl || !displayName.trim()) {
      return
    }
    setBusy(true)
    const result = await window.api.preflight.samwooWorkspaceShares.create({
      token: auth.token,
      displayName: displayName.trim(),
      repositoryUrl: selectedRepo.gitRemoteIdentity.remoteUrl,
      defaultBranch: selectedRepo.worktreeBaseRef,
      permission
    })
    setBusy(false)
    if (!result.ok) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.createFailed', 'Could not create the share.')
      )
      return
    }
    setDisplayName('')
    toast.success(
      translate('samwoo.workspaceSharing.created', 'Shared with the current Hermes profile.')
    )
    await refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto scrollbar-sleek sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate('samwoo.workspaceSharing.title', 'Team shared workspaces')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'samwoo.workspaceSharing.description',
              'Only the Git remote is shared with the same Hermes profile. Each user clones it to their own laptop. Git access is still controlled by the repository provider.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="space-y-2">
            <Label>{translate('samwoo.workspaceSharing.project', 'Project to share')}</Label>
            <Select
              value={repoId}
              onValueChange={(value) => {
                setRepoId(value)
                setDisplayName(
                  shareableRepos.find((item) => item.selectionKey === value)?.repo.displayName ?? ''
                )
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={translate(
                    'samwoo.workspaceSharing.projectPlaceholder',
                    'Select a project with a Git remote'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {shareableRepos.map(({ repo, selectionKey }) => (
                  <SelectItem key={selectionKey} value={selectionKey}>
                    {repo.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-2">
              <Label htmlFor="shared-workspace-name">
                {translate('samwoo.workspaceSharing.sharedName', 'Shared name')}
              </Label>
              <Input
                id="shared-workspace-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{translate('samwoo.workspaceSharing.permission', 'Permission')}</Label>
              <Select
                value={permission}
                onValueChange={(value) => setPermission(value as SamwooWorkspacePermission)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['view', 'clone', 'contribute'] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {getSamwooWorkspacePermissionLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button disabled={busy || !selectedRepo || !displayName.trim()} onClick={create}>
            <Plus /> {translate('samwoo.workspaceSharing.share', 'Share with profile')}
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            {translate('samwoo.workspaceSharing.list', 'Shared list')}
          </h3>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={translate('samwoo.workspaceSharing.refresh', 'Refresh')}
            disabled={busy}
            onClick={refresh}
          >
            {busy ? <Loader2 className="animate-spin" /> : <RotateCw />}
          </Button>
        </div>
        <div className="space-y-3">
          {shares.length ? (
            shares.map((share) => (
              <SharedWorkspaceShareCard
                key={share.id}
                share={share}
                login={auth?.login ?? ''}
                busy={busy}
                onRefresh={refresh}
              />
            ))
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {translate('samwoo.workspaceSharing.empty', 'There are no shared workspaces.')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
