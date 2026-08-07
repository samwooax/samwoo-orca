export type SamwooWorkspacePermission = 'view' | 'download' | 'contribute'
export type SamwooWorkspaceBoardStatus = string

export type SamwooWorkspaceShare = {
  id: string
  ownerLogin: string
  ownerProfile: string
  displayName: string
  description?: string | null
  permission: SamwooWorkspacePermission
  createdAt: number
  updatedAt: number
  boardStatus?: SamwooWorkspaceBoardStatus
  boardStatusUpdatedBy?: string | null
  boardStatusUpdatedAt?: number
  isOwner: boolean
  commentCount: number
}

export type SamwooWorkspaceFileEntry = {
  name: string
  kind: 'file' | 'directory'
  size: number
  etag: string
  modifiedAt?: string | null
}

export type SamwooWorkspaceFile = {
  path: string
  contentBase64: string
  etag: string
  size: number
}

export type SamwooWorkspaceSyncResult = {
  ok: boolean
  destinationPath?: string
  transferredFiles?: number
  skippedFiles?: number
  conflicts?: string[]
  error?: string
}

export type SamwooWorkspaceSyncDirection = 'pull' | 'push'
export type SamwooWorkspaceChangeKind = 'add' | 'modify' | 'delete' | 'conflict'
export type SamwooWorkspaceChangeOrigin = 'local' | 'remote' | 'both'
export type SamwooWorkspaceConflictChoice = 'keep_local' | 'use_remote' | 'keep_both'

export type SamwooWorkspaceChange = {
  path: string
  kind: SamwooWorkspaceChangeKind
  origin: SamwooWorkspaceChangeOrigin
}

export type SamwooWorkspaceSyncPreview = {
  ok: boolean
  destinationPath?: string
  changes?: SamwooWorkspaceChange[]
  error?: string
}

export type SamwooWorkspaceComment = {
  id: string
  shareId: string
  authorLogin: string
  body: string
  completed: boolean
  completedBy?: string | null
  completedAt?: number | null
  createdAt: number
  updatedAt: number
  isAuthor: boolean
}

export type SamwooWorkspaceShareResult = {
  ok: boolean
  errorCode?: 'file_conflict'
  share?: SamwooWorkspaceShare
  shares?: SamwooWorkspaceShare[]
  comment?: SamwooWorkspaceComment
  comments?: SamwooWorkspaceComment[]
  entries?: SamwooWorkspaceFileEntry[]
  file?: SamwooWorkspaceFile
  commentCount?: number
  completedCommentCount?: number
  hasMoreComments?: boolean
  nextBeforeCreatedAt?: number | null
  nextBeforeId?: string | null
  error?: string
}

export type CreateSamwooWorkspaceShareArgs = {
  token: string
  displayName: string
  description?: string
  permission: SamwooWorkspacePermission
}

export type PullSamwooWorkspaceFilesArgs = {
  token: string
  shareId: string
  destinationParent?: string
  folderName?: string
  destinationPath?: string
  deletePaths?: string[]
}

export type PushSamwooWorkspaceFilesArgs = {
  token: string
  shareId: string
  sourcePath: string
  deletePaths?: string[]
}

export type PreviewSamwooWorkspaceFilesArgs = {
  token: string
  shareId: string
  direction: SamwooWorkspaceSyncDirection
  localPath?: string
  destinationParent?: string
  folderName?: string
}

export type ResolveSamwooWorkspaceConflictsArgs = {
  token: string
  shareId: string
  localPath: string
  direction: SamwooWorkspaceSyncDirection
  resolutions: { path: string; choice: SamwooWorkspaceConflictChoice }[]
}

export type UpdateSamwooWorkspaceShareArgs = {
  token: string
  id: string
  displayName: string
  description?: string
  permission: SamwooWorkspacePermission
}

export type UpdateSamwooWorkspaceBoardStatusArgs = {
  token: string
  shareId: string
  status: SamwooWorkspaceBoardStatus
}

export type ListSamwooWorkspaceCommentsArgs = {
  token: string
  shareId: string
  beforeCreatedAt?: number
  beforeId?: string
}

export type CreateSamwooWorkspaceCommentArgs = ListSamwooWorkspaceCommentsArgs & {
  body: string
}

export type SetSamwooWorkspaceCommentCompletedArgs = ListSamwooWorkspaceCommentsArgs & {
  commentId: string
  completed: boolean
}
