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
}

export type SamwooWorkspaceShareResult = {
  ok: boolean
  share?: SamwooWorkspaceShare
  shares?: SamwooWorkspaceShare[]
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
