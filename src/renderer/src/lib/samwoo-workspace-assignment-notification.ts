import type { SamwooProfileEvent } from '../../../shared/samwoo-profile-messaging'

export function isWorkspaceAssignmentForLogin(
  event: SamwooProfileEvent,
  ownLogin: string
): event is Extract<SamwooProfileEvent, { type: 'workspace-assignees' }> {
  if (event.type !== 'workspace-assignees' || event.updatedBy === ownLogin) {
    return false
  }
  const ownKey = ownLogin.toLocaleLowerCase()
  return event.addedLogins.some((login) => login.toLocaleLowerCase() === ownKey)
}
