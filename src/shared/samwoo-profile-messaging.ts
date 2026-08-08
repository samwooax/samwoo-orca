export type SamwooProfileMessageChannelKind = 'team' | 'workspace'

export type SamwooProfileMessageChannel = {
  key: string
  kind: SamwooProfileMessageChannelKind
  shareId?: string | null
  label: string
  unreadCount: number
  lastMessageAt?: number | null
  lastMessagePreview?: string | null
  lastMessageAuthor?: string | null
}

export type SamwooProfileMessage = {
  id: string
  channelKey: string
  channelKind: SamwooProfileMessageChannelKind
  shareId?: string | null
  authorLogin: string
  body: string
  replyToId?: string | null
  replyToAuthor?: string | null
  replyToPreview?: string | null
  createdAt: number
  isAuthor: boolean
  /** Client-only delivery metadata; server responses omit these fields. */
  clientMessageId?: string
  deliveryState?: 'pending' | 'retrying' | 'failed'
}

export type SamwooProfileEvent =
  | { type: 'snapshot' | 'presence'; online: string[] }
  | { type: 'message'; channelKey: string; message: SamwooProfileMessage }
  | { type: 'read'; channelKey: string; login: string }
  | { type: 'expired' }

export type SamwooEventStreamStatus = 'connected' | 'disconnected' | 'expired'

export type SamwooEventStreamState = {
  status: SamwooEventStreamStatus
  onlineLogins: string[]
}

export type SamwooProfileMessagingResult = {
  ok: boolean
  channels?: SamwooProfileMessageChannel[]
  messages?: SamwooProfileMessage[]
  message?: SamwooProfileMessage
  hasMore?: boolean
  error?: string
}

export type SamwooProfileMessageChannelArgs = {
  token: string
  channelKind: SamwooProfileMessageChannelKind
  shareId?: string
}

export type ListSamwooProfileMessagesArgs = SamwooProfileMessageChannelArgs & {
  beforeCreatedAt?: number
  beforeId?: string
}

export type SendSamwooProfileMessageArgs = SamwooProfileMessageChannelArgs & {
  body: string
  replyToId?: string
  clientMessageId: string
}

export type MarkSamwooProfileMessagesReadArgs = SamwooProfileMessageChannelArgs & {
  messageId: string
}
