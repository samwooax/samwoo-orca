import { describe, expect, it } from 'vitest'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import {
  canMoveSharedWorkspace,
  collectSharedWorkspaceStatusUpdates,
  linkSharedWorkspacesToWorktrees,
  normalizeSharedWorkspacePath
} from './shared-workspace-board-status'

function share(overrides: Partial<SamwooWorkspaceShare> = {}): SamwooWorkspaceShare {
  return {
    id: 'share-1',
    ownerLogin: 'owner',
    ownerProfile: 'ai_center',
    displayName: 'Project',
    permission: 'download',
    createdAt: 1,
    updatedAt: 1,
    isOwner: false,
    commentCount: 0,
    boardStatus: 'todo',
    ...overrides
  }
}

describe('shared workspace board status', () => {
  it('matches local copies across Windows path separators and casing', () => {
    const shared = share()
    const links = linkSharedWorkspacesToWorktrees({
      shares: [shared],
      worktrees: [{ id: 'worktree-1', path: 'C:\\Work\\Project' }],
      readLocalPath: () => 'c:/work/project/',
      windows: true
    })

    expect(links.get('worktree-1')).toBe(shared)
    expect(normalizeSharedWorkspacePath('C:\\Work\\Project\\', true)).toBe('c:/work/project')
  })

  it('does not equate case-sensitive paths on macOS and Linux', () => {
    const links = linkSharedWorkspacesToWorktrees({
      shares: [share()],
      worktrees: [{ id: 'worktree-1', path: '/work/Project' }],
      readLocalPath: () => '/work/project',
      windows: false
    })

    expect(links.size).toBe(0)
  })

  it('allows owners and contributors but keeps download-only members read-only', () => {
    expect(canMoveSharedWorkspace(undefined)).toBe(true)
    expect(canMoveSharedWorkspace(share({ isOwner: true }))).toBe(true)
    expect(canMoveSharedWorkspace(share({ permission: 'contribute' }))).toBe(true)
    expect(canMoveSharedWorkspace(share({ permission: 'download' }))).toBe(false)
    expect(canMoveSharedWorkspace(share({ permission: 'view' }))).toBe(false)
  })

  it('applies valid remote lanes while preserving pending and unknown lanes', () => {
    const updates = collectSharedWorkspaceStatusUpdates({
      shareByWorktreeId: new Map([
        ['apply', share({ id: 'apply', boardStatus: 'in-progress' })],
        ['pending', share({ id: 'pending', boardStatus: 'completed' })],
        ['unknown', share({ id: 'unknown', boardStatus: 'qa' })],
        ['same', share({ id: 'same', boardStatus: 'todo' })]
      ]),
      currentStatusByWorktreeId: new Map([
        ['apply', 'todo'],
        ['pending', 'todo'],
        ['unknown', 'todo'],
        ['same', 'todo']
      ]),
      validStatusIds: new Set(['todo', 'in-progress', 'completed']),
      pendingShareIds: new Set(['pending'])
    })

    expect(Array.from(updates)).toEqual([['apply', 'in-progress']])
  })

  it('does not reinterpret shares returned by a server without board-status support', () => {
    const updates = collectSharedWorkspaceStatusUpdates({
      shareByWorktreeId: new Map([['legacy', share({ boardStatus: undefined })]]),
      currentStatusByWorktreeId: new Map([['legacy', 'in-progress']]),
      validStatusIds: new Set(['todo', 'in-progress']),
      pendingShareIds: new Set()
    })

    expect(updates.size).toBe(0)
  })
})
