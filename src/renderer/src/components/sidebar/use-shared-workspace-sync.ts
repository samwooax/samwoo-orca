import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import {
  readSharedWorkspaceLocalPath,
  writeSharedWorkspaceLocalPath
} from '@/lib/shared-workspace-local-path-store'
import {
  readSharedWorkspaceSeenRevision,
  writeSharedWorkspaceSeenRevision
} from '@/lib/shared-workspace-revision-store'
import { useAppStore } from '@/store'
import type {
  SamwooWorkspaceConflictChoice,
  SamwooWorkspaceShare,
  SamwooWorkspaceSyncDirection,
  SamwooWorkspaceSyncPreview
} from '../../../../shared/samwoo-workspace-sharing'

type PendingSync = {
  direction: SamwooWorkspaceSyncDirection
  localPath: string
  preview: SamwooWorkspaceSyncPreview
}

type Args = {
  share: SamwooWorkspaceShare
  login: string
  localName: string
  onRefresh: () => Promise<void>
}

export function useSharedWorkspaceSync({ share, login, localName, onRefresh }: Args) {
  const token = useSamwooAuthStore((state) => state.auth?.token)
  const fetchRepos = useAppStore((state) => state.fetchRepos)
  const addNonGitFolder = useAppStore((state) => state.addNonGitFolder)
  const [localPath, setLocalPath] = useState(() => readSharedWorkspaceLocalPath(login, share.id))
  const [syncing, setSyncing] = useState<SamwooWorkspaceSyncDirection | 'resolve' | null>(null)
  const [pending, setPending] = useState<PendingSync | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [conflictDirection, setConflictDirection] = useState<SamwooWorkspaceSyncDirection>('pull')
  const [seenRevision, setSeenRevision] = useState(
    () => readSharedWorkspaceSeenRevision(login, share.id) ?? share.updatedAt
  )
  const hasRemoteChanges = share.updatedAt > seenRevision
  const canWrite = share.isOwner || share.permission === 'contribute'

  useEffect(() => {
    if (readSharedWorkspaceSeenRevision(login, share.id) === null) {
      writeSharedWorkspaceSeenRevision(login, share.id, share.updatedAt)
    }
  }, [login, share.id, share.updatedAt])

  const markServerRevisionSeen = async (): Promise<void> => {
    if (!token) {
      return
    }
    const result = await window.api.preflight.samwooWorkspaceShares.list(token)
    const revision = result.shares?.find((item) => item.id === share.id)?.updatedAt
    if (result.ok && revision) {
      writeSharedWorkspaceSeenRevision(login, share.id, revision)
      setSeenRevision(revision)
    }
    await onRefresh()
  }

  const preview = async (direction: SamwooWorkspaceSyncDirection): Promise<void> => {
    if (!token) {
      return
    }
    let request: { localPath: string } | { destinationParent: string; folderName: string }
    if (localPath) {
      request = { localPath }
    } else {
      if (direction === 'push') {
        return
      }
      const destinationParent = await window.api.repos.pickDirectory()
      if (!destinationParent) {
        return
      }
      request = { destinationParent, folderName: localName }
    }
    setSyncing(direction)
    const result = await window.api.preflight.samwooWorkspaceShares.previewFiles({
      token,
      shareId: share.id,
      direction,
      ...request
    })
    setSyncing(null)
    if (!result.ok || !result.destinationPath) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.previewFailed', 'Could not preview workspace changes.')
      )
      return
    }
    setPending({ direction, localPath: result.destinationPath, preview: result })
  }

  const finishInitialPull = async (destinationPath: string): Promise<void> => {
    if (localPath) {
      return
    }
    setLocalPath(destinationPath)
    writeSharedWorkspaceLocalPath(login, share.id, destinationPath)
    const repo = await addNonGitFolder(destinationPath)
    if (repo && repo.displayName !== localName) {
      await window.api.repos.update({ repoId: repo.id, updates: { displayName: localName } })
    }
    await fetchRepos()
  }

  const confirm = async (deletePaths: string[]): Promise<void> => {
    if (!token || !pending) {
      return
    }
    const { direction, localPath: targetPath } = pending
    setSyncing(direction)
    const result =
      direction === 'pull'
        ? await window.api.preflight.samwooWorkspaceShares.pullFiles({
            token,
            shareId: share.id,
            destinationPath: targetPath,
            deletePaths
          })
        : await window.api.preflight.samwooWorkspaceShares.pushFiles({
            token,
            shareId: share.id,
            sourcePath: targetPath,
            deletePaths
          })
    setSyncing(null)
    setPending(null)
    if (!result.ok || !result.destinationPath) {
      toast.error(
        result.error ?? translate('samwoo.workspaceSharing.syncFailed', 'Workspace sync failed.')
      )
      return
    }
    if (direction === 'pull') {
      await finishInitialPull(result.destinationPath)
    }
    setConflictDirection(direction)
    setConflicts(result.conflicts ?? [])
    if (!result.conflicts?.length) {
      await markServerRevisionSeen()
      toast.success(translate('samwoo.workspaceSharing.syncComplete', 'Workspace changes applied.'))
    } else {
      await onRefresh()
    }
  }

  const resolve = async (
    resolutions: { path: string; choice: SamwooWorkspaceConflictChoice }[]
  ): Promise<void> => {
    if (!token || !localPath) {
      return
    }
    setSyncing('resolve')
    const result = await window.api.preflight.samwooWorkspaceShares.resolveConflicts({
      token,
      shareId: share.id,
      localPath,
      direction: conflictDirection,
      resolutions
    })
    setSyncing(null)
    if (!result.ok) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.resolveFailed', 'Could not resolve file conflicts.')
      )
      return
    }
    setConflicts(result.conflicts ?? [])
    if (!result.conflicts?.length) {
      await markServerRevisionSeen()
      toast.success(
        translate('samwoo.workspaceSharing.resolveComplete', 'File conflicts resolved.')
      )
    } else {
      await onRefresh()
    }
  }

  return {
    canWrite,
    conflicts,
    localPath,
    pending,
    hasRemoteChanges,
    syncing,
    confirm,
    preview,
    resolve,
    setConflicts,
    setPending
  }
}
