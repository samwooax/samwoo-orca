import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEventHandler,
  type RefObject
} from 'react'
import { translate } from '@/i18n/i18n'
import type {
  PickTeamChatAttachmentsResult,
  TeamChatAttachment
} from '../../../../shared/hermes-team-chat-attachments'

const MAX_ATTACHMENTS = 5

type AttachmentState = {
  conversationId: string
  items: TeamChatAttachment[]
  notice: string | null
}

export function useHermesTeamChatAttachments(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  disabled: boolean,
  conversationId: string,
  projectRoot: string
): {
  attachments: TeamChatAttachment[]
  attachmentNotice: string | null
  completeAttachmentSend: () => void
  attachProjectFile: (relativePath: string) => boolean
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
  const pendingProjectAttachmentsRef = useRef(0)

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

  const acceptAttachmentResult = useCallback(
    (result: PickTeamChatAttachmentsResult, ownerConversationId: string) => {
      if (
        disabledRef.current ||
        result.cancelled ||
        conversationIdRef.current !== ownerConversationId
      ) {
        releaseArtifacts(result.attachments, ownerConversationId)
        return
      }
      const current =
        stateRef.current.conversationId === ownerConversationId ? stateRef.current.items : []
      const available = Math.max(0, MAX_ATTACHMENTS - current.length)
      const accepted = result.attachments.slice(0, available)
      const overflow = result.attachments.slice(available)
      releaseArtifacts(overflow, ownerConversationId)
      const notice =
        result.rejected.length > 0
          ? translate(
              'auto.components.HermesTeamChatView.attachmentRejected',
              'Some files were not attached. Supported files are PDF, Excel, PowerPoint, images, and UTF-8 text.'
            )
          : overflow.length > 0
            ? translate(
                'auto.components.HermesTeamChatView.attachmentLimit',
                'You can attach up to 5 files.'
              )
            : null
      const next: AttachmentState = {
        conversationId: ownerConversationId,
        items: [...current, ...accepted],
        notice
      }
      stateRef.current = next
      attachmentsRef.current = next.items
      setState(next)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [releaseArtifacts, textareaRef]
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
      acceptAttachmentResult(result, conversationId)
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
  }, [acceptAttachmentResult, conversationId, updateNotice])

  const attachProjectFile = useCallback(
    (relativePath: string): boolean => {
      if (disabledRef.current || !projectRoot.trim()) {
        return false
      }
      if (attachmentsRef.current.length + pendingProjectAttachmentsRef.current >= MAX_ATTACHMENTS) {
        updateNotice(
          translate(
            'auto.components.HermesTeamChatView.attachmentLimit',
            'You can attach up to 5 files.'
          )
        )
        return true
      }
      pendingProjectAttachmentsRef.current += 1
      void window.api.preflight
        .attachHermesTeamChatProjectFile({ conversationId, cwd: projectRoot, relativePath })
        .then((result) => acceptAttachmentResult(result, conversationId))
        .catch((error: unknown) => {
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
        })
        .finally(() => {
          pendingProjectAttachmentsRef.current = Math.max(
            0,
            pendingProjectAttachmentsRef.current - 1
          )
        })
      return true
    },
    [acceptAttachmentResult, conversationId, projectRoot, updateNotice]
  )

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

  const completeAttachmentSend = useCallback(() => {
    const reusable = attachmentsRef.current.filter((attachment) => attachment.kind !== 'image')
    const next: AttachmentState = { conversationId, items: reusable, notice: null }
    stateRef.current = next
    attachmentsRef.current = reusable
    setState(next)
  }, [conversationId])

  return {
    attachments,
    attachmentNotice,
    attachProjectFile,
    completeAttachmentSend,
    pickAttachments,
    pasteClipboardImage,
    removeAttachment
  }
}
