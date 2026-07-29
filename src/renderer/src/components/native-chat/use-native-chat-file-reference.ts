import { useEffect, type RefObject } from 'react'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import {
  NATIVE_CHAT_FILE_REFERENCE_EVENT,
  type NativeChatFileReferenceRequest
} from './native-chat-file-reference'

export function useNativeChatFileReference(
  terminalTabId: string,
  composerRef: RefObject<Pick<NativeChatComposerHandle, 'insertFileReference'> | null>
): void {
  useEffect(() => {
    const handleFileReference = (event: Event): void => {
      const detail = (event as CustomEvent<NativeChatFileReferenceRequest>).detail
      if (detail.terminalTabId !== terminalTabId) {
        return
      }
      detail.handled = composerRef.current?.insertFileReference(detail.relativePath) === true
    }
    window.addEventListener(NATIVE_CHAT_FILE_REFERENCE_EVENT, handleFileReference)
    return () => window.removeEventListener(NATIVE_CHAT_FILE_REFERENCE_EVENT, handleFileReference)
  }, [composerRef, terminalTabId])
}
