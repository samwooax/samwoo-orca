export const NATIVE_CHAT_FILE_REFERENCE_EVENT = 'orca:native-chat-file-reference'

export type NativeChatFileReferenceRequest = {
  terminalTabId: string
  relativePath: string
  handled: boolean
}

export function buildNativeChatFileReferenceInsertion(args: {
  draft: string
  selectionStart: number
  selectionEnd: number
  relativePath: string
}): string {
  const { draft, selectionStart, selectionEnd } = args
  const relativePath = args.relativePath.replaceAll('\\', '/')
  const before = draft.slice(0, selectionStart)
  const after = draft.slice(selectionEnd)
  const leadingSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trailingSpace = after.length === 0 || !/^\s/.test(after) ? ' ' : ''
  return `${leadingSpace}@${relativePath}${trailingSpace}`
}

export function requestNativeChatFileReference(
  terminalTabId: string,
  relativePath: string
): boolean {
  const detail: NativeChatFileReferenceRequest = {
    terminalTabId,
    relativePath,
    handled: false
  }
  window.dispatchEvent(
    new CustomEvent<NativeChatFileReferenceRequest>(NATIVE_CHAT_FILE_REFERENCE_EVENT, { detail })
  )
  return detail.handled
}
