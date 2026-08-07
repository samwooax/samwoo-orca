import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { isSamwooSessionError } from '@/lib/samwoo-session-validation'
import { readSharedWorkspaceLocalPath } from '@/lib/shared-workspace-local-path-store'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import type { Worktree, WorkspaceStatus, WorkspaceStatusDefinition } from '../../../../shared/types'
import { getWorkspaceStatus } from './workspace-status'
import {
  canMoveSharedWorkspace,
  collectSharedWorkspaceStatusUpdates,
  linkSharedWorkspacesToWorktrees
} from './shared-workspace-board-status'

type Args = {
  open: boolean
  worktrees: readonly Worktree[]
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  updateWorktreeMeta: (worktreeId: string, updates: { workspaceStatus: WorkspaceStatus }) => unknown
}

export function useSharedWorkspaceBoardStatusSync({
  open,
  worktrees,
  workspaceStatuses,
  updateWorktreeMeta
}: Args) {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)
  const [shares, setShares] = useState<SamwooWorkspaceShare[]>([])
  const pendingShareIds = useRef(new Set<string>())
  const windows = navigator.userAgent.includes('Windows')
  const shareByWorktreeId = useMemo(
    () =>
      linkSharedWorkspacesToWorktrees({
        shares,
        worktrees,
        readLocalPath: (shareId) =>
          auth?.login ? readSharedWorkspaceLocalPath(auth.login, shareId) : '',
        windows
      }),
    [auth?.login, shares, windows, worktrees]
  )

  const refresh = useCallback(async (): Promise<void> => {
    if (!auth?.token) {
      setShares([])
      return
    }
    const result = await window.api.preflight.samwooWorkspaceShares.list(auth.token)
    if (result.ok) {
      setShares(result.shares ?? [])
    } else if (isSamwooSessionError(result.error)) {
      void logout()
    }
  }, [auth?.token, logout])

  useEffect(() => {
    if (!open || !auth?.token) {
      return
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(timer)
  }, [auth?.token, open, refresh])

  useEffect(() => {
    const validStatuses = new Set(workspaceStatuses.map((status) => status.id))
    const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree]))
    const currentStatuses = new Map(
      worktrees.map((worktree) => [worktree.id, getWorkspaceStatus(worktree, workspaceStatuses)])
    )
    const updates = collectSharedWorkspaceStatusUpdates({
      shareByWorktreeId,
      currentStatusByWorktreeId: currentStatuses,
      validStatusIds: validStatuses,
      pendingShareIds: pendingShareIds.current
    })
    for (const [worktreeId, boardStatus] of updates) {
      if (worktreeById.has(worktreeId)) {
        void updateWorktreeMeta(worktreeId, { workspaceStatus: boardStatus })
      }
    }
  }, [shareByWorktreeId, updateWorktreeMeta, workspaceStatuses, worktrees])

  const filterMovableWorktreeIds = useCallback(
    (worktreeIds: readonly string[]): string[] => {
      const movable = worktreeIds.filter((id) => canMoveSharedWorkspace(shareByWorktreeId.get(id)))
      if (movable.length !== worktreeIds.length) {
        toast.error(
          translate(
            'samwoo.workspaceSharing.statusPermissionDenied',
            'Only owners and contributors can move a shared workspace.'
          )
        )
      }
      return movable
    },
    [shareByWorktreeId]
  )

  const syncMovedWorktrees = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus): void => {
      if (!auth?.token) {
        return
      }
      const token = auth.token
      const movedShares = Array.from(
        new Map(
          worktreeIds.flatMap((id) => {
            const share = shareByWorktreeId.get(id)
            return share ? [[share.id, share] as const] : []
          })
        ).values()
      ).filter((share) => share.boardStatus && share.boardStatus !== status)
      if (movedShares.length === 0) {
        return
      }
      for (const share of movedShares) {
        pendingShareIds.current.add(share.id)
      }
      void Promise.all(
        movedShares.map((share) =>
          window.api.preflight.samwooWorkspaceShares.updateBoardStatus({
            token,
            shareId: share.id,
            status
          })
        )
      )
        .then((results) => {
          const failure = results.find((result) => !result.ok)
          if (failure && isSamwooSessionError(failure.error)) {
            void logout()
            return
          }
          if (failure) {
            toast.error(
              failure.error ??
                translate(
                  'samwoo.workspaceSharing.statusUpdateFailed',
                  'Could not update the shared workspace status.'
                )
            )
          }
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : translate(
                  'samwoo.workspaceSharing.statusUpdateFailed',
                  'Could not update the shared workspace status.'
                )
          )
        })
        .finally(() => {
          for (const share of movedShares) {
            pendingShareIds.current.delete(share.id)
          }
          void refresh()
        })
    },
    [auth?.token, logout, refresh, shareByWorktreeId]
  )

  return { filterMovableWorktreeIds, syncMovedWorktrees }
}
