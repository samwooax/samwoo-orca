import { beforeEach, describe, expect, it } from 'vitest'
import { useSamwooWorkspaceAssignmentInboxStore } from './samwoo-workspace-assignment-inbox-store'

describe('SAMWOO workspace assignment inbox', () => {
  beforeEach(() => useSamwooWorkspaceAssignmentInboxStore.getState().clear())

  it('counts each assigned workspace once until the workspace hub is viewed', () => {
    const inbox = useSamwooWorkspaceAssignmentInboxStore.getState()
    inbox.markAssigned('share-1')
    inbox.markAssigned('share-1')
    inbox.markAssigned('share-2')
    expect(useSamwooWorkspaceAssignmentInboxStore.getState().unreadShareIds.size).toBe(2)

    inbox.clear()
    expect(useSamwooWorkspaceAssignmentInboxStore.getState().unreadShareIds.size).toBe(0)
  })
})
