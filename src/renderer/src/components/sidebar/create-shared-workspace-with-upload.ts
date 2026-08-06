import type {
  CreateSamwooWorkspaceShareArgs,
  PushSamwooWorkspaceFilesArgs,
  SamwooWorkspaceShare,
  SamwooWorkspaceShareResult,
  SamwooWorkspaceSyncResult
} from '../../../../shared/samwoo-workspace-sharing'

type WorkspaceShareApi = {
  create: (args: CreateSamwooWorkspaceShareArgs) => Promise<SamwooWorkspaceShareResult>
  pushFiles: (args: PushSamwooWorkspaceFilesArgs) => Promise<SamwooWorkspaceSyncResult>
}

type Args = {
  api: WorkspaceShareApi
  token: string
  displayName: string
  permission: CreateSamwooWorkspaceShareArgs['permission']
  sourcePath: string
  onUploadStart?: (share: SamwooWorkspaceShare) => void
}

export type CreateSharedWorkspaceWithUploadResult =
  | {
      ok: true
      share: SamwooWorkspaceShare
      transferredFiles: number
      skippedFiles: number
    }
  | {
      ok: false
      phase: 'create'
      error?: string
    }
  | {
      ok: false
      phase: 'upload'
      share: SamwooWorkspaceShare
      error?: string
      conflicts: string[]
    }

export async function createSharedWorkspaceWithUpload({
  api,
  token,
  displayName,
  permission,
  sourcePath,
  onUploadStart
}: Args): Promise<CreateSharedWorkspaceWithUploadResult> {
  const created = await api.create({ token, displayName, permission })
  if (!created.ok) {
    return {
      ok: false,
      phase: 'create',
      error: created.error
    }
  }
  if (!created.share) {
    return { ok: false, phase: 'create', error: 'Share server returned no workspace.' }
  }

  onUploadStart?.(created.share)
  const uploaded = await api.pushFiles({
    token,
    shareId: created.share.id,
    sourcePath
  })
  const conflicts = uploaded.conflicts ?? []
  if (!uploaded.ok || conflicts.length > 0) {
    return {
      ok: false,
      phase: 'upload',
      share: created.share,
      error: uploaded.error,
      conflicts
    }
  }

  return {
    ok: true,
    share: created.share,
    transferredFiles: uploaded.transferredFiles ?? 0,
    skippedFiles: uploaded.skippedFiles ?? 0
  }
}
