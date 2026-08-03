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

export type TeamChatAttachment = TeamChatTextAttachment | TeamChatImageAttachment
