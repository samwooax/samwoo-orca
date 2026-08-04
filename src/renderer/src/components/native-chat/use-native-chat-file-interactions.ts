import type { RefObject } from 'react'
import type { CommentMarkdownLinkClickHandler } from '@/components/sidebar/CommentMarkdown'
import type { NativeChatComposerHandle } from './NativeChatComposer'
import { resolveNativeChatFileLinkContext } from './native-chat-file-link'
import { useNativeChatFileLinkClick } from './use-native-chat-file-link-click'
import { useNativeChatFileReference } from './use-native-chat-file-reference'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'

export function useChatFileInteractions(
  terminalTabId: string,
  composerRef: RefObject<NativeChatComposerHandle | null>
): {
  onLinkClick: CommentMarkdownLinkClickHandler | undefined
  allowFileUriLinks: boolean
} {
  const context = useAppStore(
    useShallow((state) => resolveNativeChatFileLinkContext(state, terminalTabId))
  )
  useNativeChatFileReference(terminalTabId, composerRef)
  return {
    onLinkClick: useNativeChatFileLinkClick(context),
    allowFileUriLinks: context !== null
  }
}
