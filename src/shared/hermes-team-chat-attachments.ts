export type TeamChatTextAttachment = {
  kind: 'text'
  name: string
  content: string
}

export type TeamChatImageAttachment = {
  kind: 'image'
  name: string
  path: string
}

export type HermesBinaryArtifactKind = 'pdf' | 'xlsx' | 'pptx' | 'png' | 'jpeg'

export type TeamChatArtifactAttachment = {
  kind: 'artifact'
  artifactId: string
  name: string
  artifactKind: HermesBinaryArtifactKind
  mimeType: string
  sizeBytes: number
  sha256: string
}

export type TeamChatDocumentAttachment = {
  kind: 'document'
  name: string
  contentBase64: string
}

export type TeamChatAttachment =
  | TeamChatTextAttachment
  | TeamChatImageAttachment
  | TeamChatArtifactAttachment
  | TeamChatDocumentAttachment

export type PickTeamChatAttachmentsResult = {
  cancelled: boolean
  attachments: (TeamChatTextAttachment | TeamChatArtifactAttachment)[]
  rejected: string[]
}
