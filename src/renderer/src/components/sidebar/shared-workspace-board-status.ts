import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import type { Worktree } from '../../../../shared/types'

type LocalPathReader = (shareId: string) => string

export function normalizeSharedWorkspacePath(value: string, windows: boolean): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return windows ? normalized.toLowerCase() : normalized
}

export function linkSharedWorkspacesToWorktrees(args: {
  shares: readonly SamwooWorkspaceShare[]
  worktrees: readonly Pick<Worktree, 'id' | 'path'>[]
  readLocalPath: LocalPathReader
  windows: boolean
}): Map<string, SamwooWorkspaceShare> {
  const worktreeIdByPath = new Map(
    args.worktrees.map((worktree) => [
      normalizeSharedWorkspacePath(worktree.path, args.windows),
      worktree.id
    ])
  )
  const links = new Map<string, SamwooWorkspaceShare>()
  for (const share of args.shares) {
    const localPath = args.readLocalPath(share.id)
    if (!localPath) {
      continue
    }
    const worktreeId = worktreeIdByPath.get(normalizeSharedWorkspacePath(localPath, args.windows))
    if (worktreeId) {
      links.set(worktreeId, share)
    }
  }
  return links
}

export function canMoveSharedWorkspace(share: SamwooWorkspaceShare | undefined): boolean {
  return !share || share.isOwner || share.permission === 'contribute'
}

export function collectSharedWorkspaceStatusUpdates(args: {
  shareByWorktreeId: ReadonlyMap<string, SamwooWorkspaceShare>
  currentStatusByWorktreeId: ReadonlyMap<string, string>
  validStatusIds: ReadonlySet<string>
  pendingShareIds: ReadonlySet<string>
}): Map<string, string> {
  const updates = new Map<string, string>()
  for (const [worktreeId, share] of args.shareByWorktreeId) {
    const boardStatus = share.boardStatus
    if (
      !boardStatus ||
      args.pendingShareIds.has(share.id) ||
      !args.validStatusIds.has(boardStatus) ||
      args.currentStatusByWorktreeId.get(worktreeId) === boardStatus
    ) {
      continue
    }
    updates.set(worktreeId, boardStatus)
  }
  return updates
}
