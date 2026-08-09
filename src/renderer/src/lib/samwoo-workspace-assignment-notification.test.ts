import { describe, expect, it } from 'vitest'
import type { SamwooProfileEvent } from '../../../shared/samwoo-profile-messaging'
import { isWorkspaceAssignmentForLogin } from './samwoo-workspace-assignment-notification'

const event: SamwooProfileEvent = {
  type: 'workspace-assignees',
  shareId: 'share-1',
  displayName: 'Design',
  addedLogins: ['peer'],
  updatedBy: 'owner',
  updatedAt: 123
}

describe('workspace assignment notification decision', () => {
  it('notifies only newly assigned users and ignores self-assignment', () => {
    expect(isWorkspaceAssignmentForLogin(event, 'PEER')).toBe(true)
    expect(isWorkspaceAssignmentForLogin(event, 'other')).toBe(false)
    expect(isWorkspaceAssignmentForLogin({ ...event, updatedBy: 'peer' }, 'peer')).toBe(false)
  })
})
