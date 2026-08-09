import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
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
import { createSharedWorkspaceWithUpload } from '../sidebar/create-shared-workspace-with-upload'

export type WorkspaceHubCatalog = {
  login: string
  profile: string
  shares: SamwooWorkspaceShare[]
  shareableRepos: { repo: Repo; selectionKey: string }[]
  repoId: string
  displayName: string
  permission: SamwooWorkspacePermission
  refreshing: boolean
  createStage: 'create' | 'upload' | null
  setRepoId: (value: string) => void
  setDisplayName: (value: string) => void
  setPermission: (value: SamwooWorkspacePermission) => void
  refresh: () => Promise<void>
  create: () => Promise<boolean>
  revoke: (shareId: string) => Promise<boolean>
}

export function useWorkspaceHubCatalog(): WorkspaceHubCatalog {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)
  const repos = useAppStore((state) => state.repos)
  const fetchReposForAllHosts = useAppStore((state) => state.fetchReposForAllHosts)
  const shareableRepos = useMemo(
    () =>
      repos
        .filter(
          (repo): repo is Repo =>
            !repo.connectionId && (!repo.executionHostId || repo.executionHostId === 'local')
        )
        .map((repo) => ({
          repo,
          selectionKey: `${repo.id}::${repo.executionHostId ?? repo.connectionId ?? 'local'}::${repo.path}`
        })),
    [repos]
  )
  const [shares, setShares] = useState<SamwooWorkspaceShare[]>([])
  const [repoId, setRepoId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [permission, setPermission] = useState<SamwooWorkspacePermission>('download')
  const [refreshing, setRefreshing] = useState(false)
  const [createStage, setCreateStage] = useState<'create' | 'upload' | null>(null)

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
      for (const share of nextShares) {
        if (!readSharedWorkspaceLocalPath(auth.login, share.id)) {
          continue
        }
        const seen = readSharedWorkspaceSeenRevision(auth.login, share.id)
        if (seen === null) {
          writeSharedWorkspaceSeenRevision(auth.login, share.id, share.updatedAt)
        }
      }
    },
    [auth?.login]
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
    void fetchReposForAllHosts()
    void refresh()
  }, [fetchReposForAllHosts, refresh])

  useEffect(() => {
    const refreshAssignees = (): void => void refresh()
    window.addEventListener('samwoo-workspace-assignees-updated', refreshAssignees)
    return () => window.removeEventListener('samwoo-workspace-assignees-updated', refreshAssignees)
  }, [refresh])

  useEffect(() => {
    if (!auth?.token) {
      return
    }
    const token = auth.token
    const timer = window.setInterval(async () => {
      const result = await window.api.preflight.samwooWorkspaceShares.list(token)
      if (result.ok) {
        applyShares(result.shares ?? [])
      } else {
        handleSessionError(result.error)
      }
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [applyShares, auth?.token, handleSessionError])

  useEffect(() => {
    if (shareableRepos.some((item) => item.selectionKey === repoId)) {
      return
    }
    const onlyOption = shareableRepos.length === 1 ? shareableRepos[0] : null
    setRepoId(onlyOption?.selectionKey ?? '')
    if (onlyOption && !displayName.trim()) {
      setDisplayName(onlyOption.repo.displayName)
    }
  }, [displayName, repoId, shareableRepos])

  const create = async (): Promise<boolean> => {
    const selectedRepo = shareableRepos.find((item) => item.selectionKey === repoId)?.repo
    if (!auth?.token || !selectedRepo || !displayName.trim()) {
      return false
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
          writeSharedWorkspaceLocalPath(auth.login, share.id, selectedRepo.path)
          setDisplayName('')
          setCreateStage('upload')
        }
      })
      if (!result.ok) {
        if (handleSessionError(result.error)) {
          return false
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
          return false
        }
        toast.error(
          result.error ??
            translate('samwoo.workspaceSharing.createFailed', 'Could not create the share.')
        )
        return false
      }
      toast.success(
        translate(
          'samwoo.workspaceSharing.createdAndUploaded',
          'Project shared. {{count}} files uploaded.',
          {
            count: result.transferredFiles
          }
        )
      )
      await refresh()
      return true
    } catch (error) {
      toast.error(
        translate(
          'samwoo.workspaceSharing.createUnexpected',
          'Could not create the share: {{error}}',
          {
            error: String(error)
          }
        )
      )
      return false
    } finally {
      setCreateStage(null)
    }
  }

  const revoke = async (shareId: string): Promise<boolean> => {
    if (!auth?.token) {
      return false
    }
    const result = await window.api.preflight.samwooWorkspaceShares.revoke({
      token: auth.token,
      id: shareId
    })
    if (!result.ok) {
      if (!handleSessionError(result.error)) {
        toast.error(
          result.error ??
            translate('samwoo.workspaceSharing.revokeFailed', 'Could not revoke the share.')
        )
      }
      return false
    }
    toast.success(translate('samwoo.workspaceSharing.revoked', 'Central share revoked.'))
    await refresh()
    return true
  }

  return {
    login: auth?.login ?? '',
    profile: auth?.label ?? auth?.role ?? 'Hermes',
    shares,
    shareableRepos,
    repoId,
    displayName,
    permission,
    refreshing,
    createStage,
    setRepoId,
    setDisplayName,
    setPermission,
    refresh,
    create,
    revoke
  }
}
