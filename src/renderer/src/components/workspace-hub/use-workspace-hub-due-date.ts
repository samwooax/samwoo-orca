import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { isSamwooSessionError } from '@/lib/samwoo-session-validation'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import { canMoveSharedWorkspace } from '../sidebar/shared-workspace-board-status'

export function useWorkspaceHubDueDate({
  shares,
  onRefresh
}: {
  shares: readonly SamwooWorkspaceShare[]
  onRefresh: () => Promise<void>
}) {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)
  const [updatingShareId, setUpdatingShareId] = useState<string | null>(null)

  const updateDueDate = useCallback(
    async (shareId: string, dueDate: string | null): Promise<boolean> => {
      const share = shares.find((candidate) => candidate.id === shareId)
      if (!auth?.token || !share || !canMoveSharedWorkspace(share)) {
        return false
      }
      setUpdatingShareId(shareId)
      try {
        const result = await window.api.preflight.samwooWorkspaceShares.updateDueDate({
          token: auth.token,
          shareId,
          dueDate
        })
        if (!result.ok) {
          if (isSamwooSessionError(result.error)) {
            void logout()
          } else {
            toast.error(
              result.error ??
                translate('samwoo.workspaceHub.dueDateUpdateFailed', 'Could not update due date.')
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
            : translate('samwoo.workspaceHub.dueDateUpdateFailed', 'Could not update due date.')
        )
        return false
      } finally {
        setUpdatingShareId(null)
      }
    },
    [auth?.token, logout, onRefresh, shares]
  )

  return { updatingShareId, updateDueDate }
}
