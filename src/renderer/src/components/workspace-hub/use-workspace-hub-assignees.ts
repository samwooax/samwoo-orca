import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooProfileMemberStore } from '@/lib/samwoo-profile-member-store'
import { isSamwooSessionError } from '@/lib/samwoo-session-validation'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import { canMoveSharedWorkspace } from '../sidebar/shared-workspace-board-status'

export function useWorkspaceHubAssignees({
  shares,
  onRefresh
}: {
  shares: readonly SamwooWorkspaceShare[]
  onRefresh: () => Promise<void>
}) {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)
  const members = useSamwooProfileMemberStore((state) => state.members)
  const loadMembers = useSamwooProfileMemberStore((state) => state.load)
  const [updatingShareId, setUpdatingShareId] = useState<string | null>(null)

  useEffect(() => {
    if (auth?.token && auth.login) {
      void loadMembers(auth.token, auth.login)
    }
  }, [auth?.login, auth?.token, loadMembers])

  const updateAssignees = useCallback(
    async (shareId: string, assigneeLogins: string[]): Promise<boolean> => {
      const share = shares.find((candidate) => candidate.id === shareId)
      if (!auth?.token || !share || !canMoveSharedWorkspace(share)) {
        return false
      }
      setUpdatingShareId(shareId)
      try {
        const result = await window.api.preflight.samwooWorkspaceShares.updateAssignees({
          token: auth.token,
          shareId,
          assigneeLogins
        })
        if (!result.ok) {
          if (isSamwooSessionError(result.error)) {
            void logout()
          } else {
            toast.error(
              result.error ??
                translate('samwoo.workspaceHub.assigneeUpdateFailed', 'Could not update assignees.')
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
            : translate('samwoo.workspaceHub.assigneeUpdateFailed', 'Could not update assignees.')
        )
        return false
      } finally {
        setUpdatingShareId(null)
      }
    },
    [auth?.token, logout, onRefresh, shares]
  )

  return { members, updatingShareId, updateAssignees }
}
