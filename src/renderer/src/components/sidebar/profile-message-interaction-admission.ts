export function shouldApplyProfileMessageResponse(
  requestedChannelKey: string,
  activeChannelKey: string
): boolean {
  return requestedChannelKey === activeChannelKey
}

export function shouldSubmitProfileMessageKey(args: {
  key: string
  shiftKey: boolean
  isComposing: boolean
}): boolean {
  return args.key === 'Enter' && !args.shiftKey && !args.isComposing
}

export function shouldMarkProfileMessagesRead(args: {
  messageId: string
  lastMarkedMessageId?: string
  isAtBottom: boolean
  documentHasFocus: boolean
}): boolean {
  return args.isAtBottom && args.documentHasFocus && args.messageId !== args.lastMarkedMessageId
}

export function shouldPollProfileMessages(args: {
  documentHidden: boolean
  elapsedMs: number
  backgroundRefreshMs: number
}): boolean {
  return !args.documentHidden || args.elapsedMs >= args.backgroundRefreshMs
}
