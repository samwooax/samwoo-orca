import { useCallback, useImperativeHandle } from 'react'
import type { ForwardedRef, RefObject } from 'react'
import { buildNativeChatFileReferenceInsertion } from './native-chat-file-reference'
import type { NativeChatComposerHandle } from './native-chat-composer-types'

type NativeChatComposerHandleOptions = {
  forwardedRef: ForwardedRef<NativeChatComposerHandle>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  caret: number
  focus: NativeChatComposerHandle['focus']
  insertTypedText: NativeChatComposerHandle['insertTypedText']
  handlePasteEvent: NativeChatComposerHandle['handlePasteEvent']
  pasteFromClipboard: NativeChatComposerHandle['pasteFromClipboard']
}

export function useNativeChatComposerHandle({
  forwardedRef,
  textareaRef,
  draft,
  caret,
  focus,
  insertTypedText,
  handlePasteEvent,
  pasteFromClipboard
}: NativeChatComposerHandleOptions): void {
  const insertFileReference = useCallback(
    (relativePath: string): boolean => {
      const textarea = textareaRef.current
      if (!textarea || textarea.disabled) {
        return false
      }
      return insertTypedText(
        buildNativeChatFileReferenceInsertion({
          draft,
          selectionStart: textarea.selectionStart ?? caret,
          selectionEnd: textarea.selectionEnd ?? textarea.selectionStart ?? caret,
          relativePath
        })
      )
    },
    [caret, draft, insertTypedText, textareaRef]
  )

  useImperativeHandle(
    forwardedRef,
    () => ({ focus, insertTypedText, insertFileReference, handlePasteEvent, pasteFromClipboard }),
    [focus, insertTypedText, insertFileReference, handlePasteEvent, pasteFromClipboard]
  )
}
