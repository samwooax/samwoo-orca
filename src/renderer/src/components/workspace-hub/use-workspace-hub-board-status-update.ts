import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { isSamwooSessionError } from '@/lib/samwoo-session-validation'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import { canMoveSharedWorkspace } from '../sidebar/shared-workspace-board-status'

export function useWorkspaceHubBoardStatusUpdate({
  shares,
  onRefresh
}: {
  shares: readonly SamwooWorkspaceShare[]
  onRefresh: () => Promise<void>
}): {
  updatingShareId: string | null
  updateBoardStatus: (shareId: string, status: string) => Promise<boolean>
} {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)
  const [updatingShareId, setUpdatingShareId] = useState<string | null>(null)

  const updateBoardStatus = useCallback(
    async (shareId: string, status: string): Promise<boolean> => {
      const share = shares.find((candidate) => candidate.id === shareId)
      if (!auth?.token || !share?.boardStatus || share.boardStatus === status) {
        return false
      }
      if (!canMoveSharedWorkspace(share)) {
        toast.error(
          translate(
            'samwoo.workspaceSharing.statusPermissionDenied',
            'Only owners and contributors can move a shared workspace.'
          )
        )
        return false
      }
      setUpdatingShareId(shareId)
      try {
        const result = await window.api.preflight.samwooWorkspaceShares.updateBoardStatus({
          token: auth.token,
          shareId,
          status
        })
        if (!result.ok) {
          if (isSamwooSessionError(result.error)) {
            void logout()
          } else {
            toast.error(
              result.error ??
                translate(
                  'samwoo.workspaceSharing.statusUpdateFailed',
                  'Could not update the shared workspace status.'
                )
            )
          }
          return false
        }
        await onRefresh()
        return true
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'samwoo.workspaceSharing.statusUpdateFailed',
                'Could not update the shared workspace status.'
              )
        )
        return false
      } finally {
        setUpdatingShareId(null)
      }
    },
    [auth?.token, logout, onRefresh, shares]
  )

  return { updatingShareId, updateBoardStatus }
}
