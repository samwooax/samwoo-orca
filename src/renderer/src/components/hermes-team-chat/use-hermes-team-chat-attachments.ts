import { useCallback, useRef, useState, type ClipboardEventHandler, type RefObject } from 'react'
import { translate } from '@/i18n/i18n'
import type { TeamChatAttachment } from '../../../../shared/hermes-team-chat-attachments'

const MAX_ATTACHMENTS = 5
const MAX_TEXT_ATTACHMENT_BYTES = 96_000

export function useHermesTeamChatAttachments(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  disabled: boolean
): {
  attachments: TeamChatAttachment[]
  attachmentNotice: string | null
  clearAttachments: () => void
  readAttachments: (files: FileList | null) => Promise<void>
  pasteClipboardImage: ClipboardEventHandler<HTMLTextAreaElement>
  removeAttachment: (attachment: TeamChatAttachment) => void
} {
  const [attachments, setAttachments] = useState<TeamChatAttachment[]>([])
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const readAttachments = useCallback(async (files: FileList | null) => {
    const selected = Array.from(files ?? [])
    const readable = selected.filter((file) => file.size <= MAX_TEXT_ATTACHMENT_BYTES)
    const next = await Promise.all(
      readable.map(async (file) => ({
        kind: 'text' as const,
        name: file.name,
        content: await file.text()
      }))
    )
    if (disabledRef.current) {
      return
    }
    setAttachments((current) => [...current, ...next].slice(0, MAX_ATTACHMENTS))
    setAttachmentNotice(
      readable.length < selected.length
        ? translate(
            'auto.components.HermesTeamChatView.attachmentTooLarge',
            'Attachments must be 96 KB or smaller.'
          )
        : null
    )
  }, [])

  const pasteClipboardImage = useCallback<ClipboardEventHandler<HTMLTextAreaElement>>(
    (event) => {
      if (!Array.from(event.clipboardData.items).some((item) => item.type.startsWith('image/'))) {
        return
      }
      event.preventDefault()
      if (attachments.length >= MAX_ATTACHMENTS) {
        setAttachmentNotice(
          translate(
            'auto.components.HermesTeamChatView.attachmentLimit',
            'You can attach up to 5 files.'
          )
        )
        return
      }
      void window.api.ui
        .saveClipboardImageAsTempFile()
        .then((path) => {
          if (disabledRef.current) {
            return
          }
          if (!path) {
            setAttachmentNotice(
              translate(
                'auto.components.HermesTeamChatView.imagePasteFailed',
                'Image paste failed.'
              )
            )
            return
          }
          setAttachments((current) =>
            [...current, { kind: 'image' as const, name: 'pasted-image.png', path }].slice(
              0,
              MAX_ATTACHMENTS
            )
          )
          setAttachmentNotice(null)
          requestAnimationFrame(() => textareaRef.current?.focus())
        })
        .catch((error: unknown) => {
          if (!disabledRef.current) {
            setAttachmentNotice(
              error instanceof Error
                ? error.message
                : translate(
                    'auto.components.HermesTeamChatView.imagePasteFailed',
                    'Image paste failed.'
                  )
            )
          }
        })
    },
    [attachments.length, textareaRef]
  )

  return {
    attachments,
    attachmentNotice,
    clearAttachments: () => setAttachments([]),
    readAttachments,
    pasteClipboardImage,
    removeAttachment: (attachment) =>
      setAttachments((current) => current.filter((item) => item !== attachment))
  }
}
