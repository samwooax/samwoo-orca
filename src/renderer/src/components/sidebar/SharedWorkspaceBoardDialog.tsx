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
import { writeSharedWorkspaceLocalPath } from '@/lib/shared-workspace-local-path-store'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/types'
import type {
  SamwooWorkspacePermission,
  SamwooWorkspaceShare,
  SamwooWorkspaceSourceKind
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
  const fetchReposForAllHosts = useAppStore((state) => state.fetchReposForAllHosts)
  const localRepos = useMemo(
    () =>
      repos.filter(
        (repo): repo is Repo =>
          !repo.connectionId && (!repo.executionHostId || repo.executionHostId === 'local')
      ),
    [repos]
  )
  const [sourceKind, setSourceKind] = useState<SamwooWorkspaceSourceKind>('nextcloud')
  const shareableRepos = useMemo(
    () =>
      localRepos
        .filter((repo) => sourceKind === 'nextcloud' || Boolean(repo.gitRemoteIdentity?.remoteUrl))
        .map((repo) => ({
          repo,
          selectionKey: `${repo.id}::${repo.executionHostId ?? repo.connectionId ?? 'local'}::${repo.path}`
        })),
    [localRepos, sourceKind]
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
      // Why: a project can gain a Git remote after Orca first catalogs it.
      void fetchReposForAllHosts()
      void refresh()
    }
  }, [fetchReposForAllHosts, open, refresh])

  useEffect(() => {
    if (!open) {
      return
    }
    const selectedOption = shareableRepos.find((item) => item.selectionKey === repoId)
    if (selectedOption) {
      return
    }
    const onlyOption = shareableRepos.length === 1 ? shareableRepos[0] : null
    setRepoId(onlyOption?.selectionKey ?? '')
    if (onlyOption && !displayName.trim()) {
      setDisplayName(onlyOption.repo.displayName)
    }
  }, [displayName, open, repoId, shareableRepos])

  const selectedRepo = shareableRepos.find((item) => item.selectionKey === repoId)?.repo
  const create = async (): Promise<void> => {
    const repositoryUrl = selectedRepo?.gitRemoteIdentity?.remoteUrl
    if (
      !auth?.token ||
      !selectedRepo ||
      !displayName.trim() ||
      (sourceKind === 'git' && !repositoryUrl)
    ) {
      return
    }
    setBusy(true)
    const result = await window.api.preflight.samwooWorkspaceShares.create({
      token: auth.token,
      displayName: displayName.trim(),
      sourceKind,
      repositoryUrl,
      defaultBranch: selectedRepo.worktreeBaseRef,
      permission
    })
    if (!result.ok) {
      setBusy(false)
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.createFailed', 'Could not create the share.')
      )
      return
    }
    if (sourceKind === 'nextcloud' && result.share) {
      // Why: preserve the retry source even when the initial multi-file upload stops partway.
      writeSharedWorkspaceLocalPath(auth.login, result.share.id, selectedRepo.path)
      const upload = await window.api.preflight.samwooWorkspaceShares.pushFiles({
        token: auth.token,
        shareId: result.share.id,
        sourcePath: selectedRepo.path
      })
      if (!upload.ok) {
        setBusy(false)
        toast.error(
          translate(
            'samwoo.workspaceSharing.initialUploadFailed',
            'The share was created, but its files could not be uploaded.'
          ),
          { description: upload.error }
        )
        await refresh()
        return
      }
    }
    setBusy(false)
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
              'Projects are stored in the current Hermes profile workspace. Other profiles cannot list or download them, and each user works from a local copy.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="space-y-2">
            <Label>{translate('samwoo.workspaceSharing.storage', 'Sharing method')}</Label>
            <Select
              value={sourceKind}
              onValueChange={(value) => {
                setSourceKind(value as SamwooWorkspaceSourceKind)
                setRepoId('')
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nextcloud">
                  {translate(
                    'samwoo.workspaceSharing.nextcloud',
                    'Company cloud (no GitHub account)'
                  )}
                </SelectItem>
                <SelectItem value="git">
                  {translate('samwoo.workspaceSharing.gitRemote', 'Git remote')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
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
                  placeholder={
                    sourceKind === 'nextcloud'
                      ? translate(
                          'samwoo.workspaceSharing.localProjectPlaceholder',
                          'Select a local project'
                        )
                      : translate(
                          'samwoo.workspaceSharing.projectPlaceholder',
                          'Select a project with a Git remote'
                        )
                  }
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
