import type { SamwooProfileEvent } from '../../../shared/samwoo-profile-messaging'
import { canonicalSamwooLogin } from '../../../shared/samwoo-login-identity'

export function isWorkspaceAssignmentForLogin(
  event: SamwooProfileEvent,
  ownLogin: string
): event is Extract<SamwooProfileEvent, { type: 'workspace-assignees' }> {
  if (
    event.type !== 'workspace-assignees' ||
    canonicalSamwooLogin(event.updatedBy) === canonicalSamwooLogin(ownLogin)
  ) {
    return false
  }
  const ownKey = canonicalSamwooLogin(ownLogin)
  return event.addedLogins.some((login) => canonicalSamwooLogin(login) === ownKey)
}
