import { describe, expect, it } from 'vitest'
import { resolveWorkspaceBoardStatusDrop } from './WorkspaceHubBoardView'

describe('resolveWorkspaceBoardStatusDrop', () => {
  it('moves an authorized shared workspace to a different lane', () => {
    expect(
      resolveWorkspaceBoardStatusDrop(
        {
          kind: 'workspace-share',
          shareId: 'share-1',
          currentStatus: 'todo',
          canMove: true
        },
        { kind: 'workspace-status', statusId: 'in-progress' }
      )
    ).toEqual({ shareId: 'share-1', status: 'in-progress' })
  })

  it('ignores same-lane, unauthorized, and invalid drops', () => {
    const active = {
      kind: 'workspace-share' as const,
      shareId: 'share-1',
      currentStatus: 'todo',
      canMove: true
    }
    expect(
      resolveWorkspaceBoardStatusDrop(active, {
        kind: 'workspace-status',
        statusId: 'todo'
      })
    ).toBeNull()
    expect(
      resolveWorkspaceBoardStatusDrop(
        { ...active, canMove: false },
        { kind: 'workspace-status', statusId: 'done' }
      )
    ).toBeNull()
    expect(resolveWorkspaceBoardStatusDrop(active, undefined)).toBeNull()
  })
})
