import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type RefObject
} from 'react'
import { translate } from '@/i18n/i18n'
import type { TeamChatAttachment } from '../../../../shared/hermes-team-chat-attachments'

const MAX_ATTACHMENTS = 5

type AttachmentState = {
  conversationId: string
  items: TeamChatAttachment[]
  notice: string | null
}

export function useHermesTeamChatAttachments(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  disabled: boolean,
  conversationId: string
): {
  attachments: TeamChatAttachment[]
  attachmentNotice: string | null
  clearAttachments: () => void
  pickAttachments: () => Promise<void>
  pasteClipboardImage: ClipboardEventHandler<HTMLTextAreaElement>
  removeAttachment: (attachment: TeamChatAttachment) => void
} {
  const [state, setState] = useState<AttachmentState>({
    conversationId,
    items: [],
    notice: null
  })
  const attachments = state.conversationId === conversationId ? state.items : []
  const attachmentNotice = state.conversationId === conversationId ? state.notice : null
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const stateRef = useRef(state)
  stateRef.current = state
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId
  const pickingRef = useRef(false)

  const releaseArtifacts = useCallback(
    (items: TeamChatAttachment[], ownerConversationId: string) => {
      for (const attachment of items) {
        if (attachment.kind === 'artifact') {
          void window.api.preflight.releaseHermesTeamChatArtifact({
            conversationId: ownerConversationId,
            artifactId: attachment.artifactId
          })
        }
      }
    },
    []
  )

  useEffect(() => {
    if (state.conversationId !== conversationId) {
      releaseArtifacts(state.items, state.conversationId)
    }
  }, [conversationId, releaseArtifacts, state])

  useEffect(
    () => () => {
      const latest = stateRef.current
      releaseArtifacts(latest.items, latest.conversationId)
    },
    [releaseArtifacts]
  )

  const updateItems = useCallback(
    (update: (items: TeamChatAttachment[]) => TeamChatAttachment[]) => {
      setState((current) => ({
        conversationId,
        items: update(current.conversationId === conversationId ? current.items : []),
        notice: current.conversationId === conversationId ? current.notice : null
      }))
    },
    [conversationId]
  )

  const updateNotice = useCallback(
    (notice: string | null) => {
      setState((current) => ({
        conversationId,
        items: current.conversationId === conversationId ? current.items : [],
        notice
      }))
    },
    [conversationId]
  )

  const pickAttachments = useCallback(async () => {
    if (
      pickingRef.current ||
      disabledRef.current ||
      attachmentsRef.current.length >= MAX_ATTACHMENTS
    ) {
      return
    }
    pickingRef.current = true
    try {
      const result = await window.api.preflight.pickHermesTeamChatAttachments({
        conversationId,
        remainingSlots: MAX_ATTACHMENTS - attachmentsRef.current.length
      })
      if (disabledRef.current || result.cancelled || conversationIdRef.current !== conversationId) {
        releaseArtifacts(result.attachments, conversationId)
        return
      }
      const available = MAX_ATTACHMENTS - attachmentsRef.current.length
      const accepted = result.attachments.slice(0, available)
      releaseArtifacts(result.attachments.slice(available), conversationId)
      updateItems((current) => [...current, ...accepted].slice(0, MAX_ATTACHMENTS))
      updateNotice(
        result.rejected.length > 0
          ? translate(
              'auto.components.HermesTeamChatView.attachmentRejected',
              'Some files were not attached. Supported files are PDF, Excel, PowerPoint, images, and UTF-8 text.'
            )
          : null
      )
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (error) {
      if (!disabledRef.current && conversationIdRef.current === conversationId) {
        updateNotice(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.HermesTeamChatView.attachmentRejected',
                'Some files were not attached. Supported files are PDF, Excel, PowerPoint, images, and UTF-8 text.'
              )
        )
      }
    } finally {
      pickingRef.current = false
    }
  }, [conversationId, releaseArtifacts, textareaRef, updateItems, updateNotice])

  const pasteClipboardImage = useCallback<ClipboardEventHandler<HTMLTextAreaElement>>(
    (event) => {
      if (!Array.from(event.clipboardData.items).some((item) => item.type.startsWith('image/'))) {
        return
      }
      event.preventDefault()
      if (attachments.length >= MAX_ATTACHMENTS) {
        updateNotice(
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
          if (disabledRef.current || conversationIdRef.current !== conversationId) {
            return
          }
          if (!path) {
            updateNotice(
              translate(
                'auto.components.HermesTeamChatView.imagePasteFailed',
                'Image paste failed.'
              )
            )
            return
          }
          updateItems((current) =>
            [...current, { kind: 'image' as const, name: 'pasted-image.png', path }].slice(
              0,
              MAX_ATTACHMENTS
            )
          )
          updateNotice(null)
          requestAnimationFrame(() => textareaRef.current?.focus())
        })
        .catch((error: unknown) => {
          if (!disabledRef.current && conversationIdRef.current === conversationId) {
            updateNotice(
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
    [attachments.length, conversationId, textareaRef, updateItems, updateNotice]
  )

  const removeAttachment = useCallback(
    (attachment: TeamChatAttachment) => {
      updateItems((current) => current.filter((item) => item !== attachment))
      releaseArtifacts([attachment], conversationId)
    },
    [conversationId, releaseArtifacts, updateItems]
  )

  const clearAttachments = useCallback(() => {
    // Ownership moves to main when the send IPC consumes the captured attachment list.
    const next: AttachmentState = { conversationId, items: [], notice: null }
    stateRef.current = next
    attachmentsRef.current = []
    setState(next)
  }, [conversationId])

  return {
    attachments,
    attachmentNotice,
    clearAttachments,
    pickAttachments,
    pasteClipboardImage,
    removeAttachment
  }
}
