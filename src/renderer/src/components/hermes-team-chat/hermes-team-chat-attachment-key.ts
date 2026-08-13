import type { TeamChatAttachment } from '../../../../shared/hermes-team-chat-attachments'

export function teamChatAttachmentKey(attachment: TeamChatAttachment): string {
  if (attachment.kind === 'image') {
    return attachment.path
  }
  if (attachment.kind === 'artifact') {
    return attachment.artifactId
  }
  return `${attachment.name}:${attachment.kind === 'text' ? attachment.content : attachment.contentBase64}`
}
