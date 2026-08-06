export type SamwooWorkspacePermission = 'view' | 'clone' | 'contribute'

export type SamwooWorkspaceShare = {
  id: string
  ownerLogin: string
  ownerProfile: string
  displayName: string
  repositoryUrl: string
  defaultBranch?: string | null
  description?: string | null
  permission: SamwooWorkspacePermission
  createdAt: number
  updatedAt: number
  isOwner: boolean
  commentCount: number
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
  share?: SamwooWorkspaceShare
  shares?: SamwooWorkspaceShare[]
  comment?: SamwooWorkspaceComment
  comments?: SamwooWorkspaceComment[]
  error?: string
}

export type CreateSamwooWorkspaceShareArgs = {
  token: string
  displayName: string
  repositoryUrl: string
  defaultBranch?: string
  description?: string
  permission: SamwooWorkspacePermission
}

export type UpdateSamwooWorkspaceShareArgs = {
  token: string
  id: string
  displayName: string
  description?: string
  permission: SamwooWorkspacePermission
}

export type ListSamwooWorkspaceCommentsArgs = {
  token: string
  shareId: string
}

export type CreateSamwooWorkspaceCommentArgs = ListSamwooWorkspaceCommentsArgs & {
  body: string
}

export type SetSamwooWorkspaceCommentCompletedArgs = ListSamwooWorkspaceCommentsArgs & {
  commentId: string
  completed: boolean
}
