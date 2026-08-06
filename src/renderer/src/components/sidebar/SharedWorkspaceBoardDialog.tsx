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
import { isSamwooSessionError } from '@/lib/samwoo-session-validation'
import {
  readSharedWorkspaceLocalPath,
  writeSharedWorkspaceLocalPath
} from '@/lib/shared-workspace-local-path-store'
import {
  readSharedWorkspaceSeenRevision,
  writeSharedWorkspaceSeenRevision
} from '@/lib/shared-workspace-revision-store'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/types'
import type {
  SamwooWorkspacePermission,
  SamwooWorkspaceShare
} from '../../../../shared/samwoo-workspace-sharing'
import SharedWorkspaceShareCard, {
  getSamwooWorkspacePermissionLabel
} from './SharedWorkspaceShareCard'
import { createSharedWorkspaceWithUpload } from './create-shared-workspace-with-upload'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewChangesCountChange?: (count: number) => void
}

export default function SharedWorkspaceBoardDialog({
  open,
  onOpenChange,
  onNewChangesCountChange
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
  const shareableRepos = useMemo(
    () =>
      localRepos.map((repo) => ({
        repo,
        selectionKey: `${repo.id}::${repo.executionHostId ?? repo.connectionId ?? 'local'}::${repo.path}`
      })),
    [localRepos]
  )
  const [shares, setShares] = useState<SamwooWorkspaceShare[]>([])
  const [repoId, setRepoId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [permission, setPermission] = useState<SamwooWorkspacePermission>('download')
  const logout = useSamwooAuthStore((state) => state.logout)
  const [refreshing, setRefreshing] = useState(false)
  const [createStage, setCreateStage] = useState<'create' | 'upload' | null>(null)
  const busy = refreshing || createStage !== null

  const handleSessionError = useCallback(
    (error: string | undefined): boolean => {
      if (!isSamwooSessionError(error)) {
        return false
      }
      toast.error(
        translate(
          'samwoo.workspaceSharing.sessionExpired',
          'Your session has expired. Sign in again.'
        )
      )
      void logout()
      return true
    },
    [logout]
  )

  const applyShares = useCallback(
    (nextShares: SamwooWorkspaceShare[]): void => {
      setShares(nextShares)
      if (!auth?.login) {
        return
      }
      let newChangesCount = 0
      for (const share of nextShares) {
        if (!readSharedWorkspaceLocalPath(auth.login, share.id)) {
          continue
        }
        const seen = readSharedWorkspaceSeenRevision(auth.login, share.id)
        if (seen === null) {
          writeSharedWorkspaceSeenRevision(auth.login, share.id, share.updatedAt)
        } else if (share.updatedAt > seen) {
          newChangesCount += 1
        }
      }
      onNewChangesCountChange?.(newChangesCount)
    },
    [auth?.login, onNewChangesCountChange]
  )

  const refresh = useCallback(async (): Promise<void> => {
    if (!auth?.token) {
      handleSessionError('login required')
      return
    }
    setRefreshing(true)
    const result = await window.api.preflight.samwooWorkspaceShares.list(auth.token)
    setRefreshing(false)
    if (result.ok) {
      applyShares(result.shares ?? [])
    } else if (!handleSessionError(result.error)) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.loadFailed', 'Could not load shared workspaces.')
      )
    }
  }, [applyShares, auth?.token, handleSessionError])

  useEffect(() => {
    if (!auth?.token) {
      return
    }
    const token = auth.token
    const poll = async (): Promise<void> => {
      const result = await window.api.preflight.samwooWorkspaceShares.list(token)
      if (result.ok) {
        applyShares(result.shares ?? [])
      } else {
        handleSessionError(result.error)
      }
    }
    const timer = window.setInterval(() => void poll(), 60_000)
    return () => window.clearInterval(timer)
  }, [applyShares, auth?.token, handleSessionError])

  useEffect(() => {
    if (open) {
      // Why: projects discovered after startup must be available to the share picker.
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
    if (!auth?.token) {
      handleSessionError('login required')
      return
    }
    if (!selectedRepo || !displayName.trim()) {
      return
    }
    setCreateStage('create')
    try {
      const result = await createSharedWorkspaceWithUpload({
        api: window.api.preflight.samwooWorkspaceShares,
        token: auth.token,
        displayName: displayName.trim(),
        permission,
        sourcePath: selectedRepo.path,
        onUploadStart: (share) => {
          // Why: retain the retry path even when an initial upload only partially succeeds.
          writeSharedWorkspaceLocalPath(auth.login, share.id, selectedRepo.path)
          setDisplayName('')
          setCreateStage('upload')
        }
      })
      if (!result.ok) {
        if (handleSessionError(result.error)) {
          return
        }
        if (result.phase === 'upload') {
          toast.error(
            result.error
              ? translate(
                  'samwoo.workspaceSharing.initialUploadUnexpected',
                  'The share was created, but file upload failed: {{error}} Retry from the shared card.',
                  { error: result.error }
                )
              : translate(
                  'samwoo.workspaceSharing.initialUploadFailed',
                  'The share was created, but its files could not be uploaded. Retry from the shared card.'
                )
          )
          await refresh()
          return
        }
        toast.error(
          result.error ??
            translate('samwoo.workspaceSharing.createFailed', 'Could not create the share.')
        )
        return
      }
      toast.success(
        translate(
          'samwoo.workspaceSharing.createdAndUploaded',
          'Project shared. {{count}} files uploaded.',
          { count: result.transferredFiles }
        )
      )
      await refresh()
    } catch (error) {
      toast.error(
        translate(
          'samwoo.workspaceSharing.createUnexpected',
          'Could not create the share: {{error}}',
          { error: String(error) }
        )
      )
    } finally {
      setCreateStage(null)
    }
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
                    'samwoo.workspaceSharing.localProjectPlaceholder',
                    'Select a local project'
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
                  {(['view', 'download', 'contribute'] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {getSamwooWorkspacePermissionLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="w-44"
            disabled={busy || !selectedRepo || !displayName.trim()}
            onClick={create}
          >
            {createStage ? <Loader2 className="animate-spin" /> : <Plus />}
            {createStage === 'create'
              ? translate('samwoo.workspaceSharing.creating', 'Creating share…')
              : createStage === 'upload'
                ? translate('samwoo.workspaceSharing.uploadingInitial', 'Uploading files…')
                : translate('samwoo.workspaceSharing.share', 'Share with profile')}
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
            {refreshing ? <Loader2 className="animate-spin" /> : <RotateCw />}
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
