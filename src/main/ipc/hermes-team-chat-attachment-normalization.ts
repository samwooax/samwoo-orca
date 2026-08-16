import { extname } from 'node:path'
import type {
  HermesBinaryArtifactKind,
  TeamChatArtifactAttachment,
  TeamChatAttachment,
  TeamChatDocumentAttachment
} from '../../shared/hermes-team-chat-attachments'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import type { LocalDocumentAttachment } from './hermes-local-document-protocol'

const MAX_TEXT_ATTACHMENT_CHARS = 96_000
const MAX_DOCUMENT_ATTACHMENT_BYTES = 64 * 1024 * 1024
const MAX_DOCUMENT_BASE64_CHARS = Math.ceil(MAX_DOCUMENT_ATTACHMENT_BYTES / 3) * 4
const ARTIFACT_KINDS = new Set<HermesBinaryArtifactKind>(['pdf', 'xlsx', 'pptx', 'png', 'jpeg'])

export type PreparedTeamChatImageAttachment =
  | {
      source: 'clipboard'
      name: string
      path: string
    }
  | {
      source: 'artifact'
      name: string
      artifactId: string
      artifactKind: 'png' | 'jpeg'
      conversationId: string
    }

function cleanName(value: string): string {
  return value.replaceAll(/[\r\n[\]]/g, '').slice(0, 160)
}

function decodeLegacyAttachment(
  attachment: TeamChatDocumentAttachment,
  remainingBytes: number
): Buffer | null {
  if (
    !['.pdf', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg'].includes(
      extname(attachment.name).toLowerCase()
    ) ||
    attachment.contentBase64.length > MAX_DOCUMENT_BASE64_CHARS
  ) {
    return null
  }
  const content = Buffer.from(attachment.contentBase64, 'base64')
  if (
    content.length === 0 ||
    content.length > remainingBytes ||
    content.toString('base64') !== attachment.contentBase64
  ) {
    return null
  }
  return content
}

function normalizeArtifact(candidate: Record<string, unknown>): TeamChatArtifactAttachment | null {
  if (
    typeof candidate.artifactId !== 'string' ||
    !/^artifact-[0-9a-f-]{36}$/.test(candidate.artifactId) ||
    typeof candidate.name !== 'string' ||
    !ARTIFACT_KINDS.has(candidate.artifactKind as HermesBinaryArtifactKind) ||
    typeof candidate.mimeType !== 'string' ||
    !Number.isInteger(candidate.sizeBytes) ||
    Number(candidate.sizeBytes) < 1 ||
    Number(candidate.sizeBytes) > MAX_DOCUMENT_ATTACHMENT_BYTES ||
    typeof candidate.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(candidate.sha256)
  ) {
    return null
  }
  return {
    kind: 'artifact',
    artifactId: candidate.artifactId,
    name: cleanName(candidate.name),
    artifactKind: candidate.artifactKind as HermesBinaryArtifactKind,
    mimeType: candidate.mimeType,
    sizeBytes: Number(candidate.sizeBytes),
    sha256: candidate.sha256
  }
}

export function normalizeTeamChatAttachments(value: unknown): TeamChatAttachment[] {
  if (!Array.isArray(value)) {
    return []
  }
  let remainingText = MAX_TEXT_ATTACHMENT_CHARS
  let remainingLegacyBytes = MAX_DOCUMENT_ATTACHMENT_BYTES
  const result: TeamChatAttachment[] = []
  for (const item of value.slice(0, 5)) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as { name?: unknown }).name !== 'string'
    ) {
      continue
    }
    const candidate = item as Record<string, unknown> & { name: string }
    const name = cleanName(candidate.name)
    if (candidate.kind === 'artifact') {
      const artifact = normalizeArtifact(candidate)
      if (artifact) {
        result.push(artifact)
      }
      continue
    }
    if (
      candidate.kind === 'image' &&
      typeof candidate.path === 'string' &&
      candidate.path.length <= 1024
    ) {
      result.push({ kind: 'image', name, path: candidate.path })
      continue
    }
    if (candidate.kind === 'document' && typeof candidate.contentBase64 === 'string') {
      const legacy = { kind: 'document' as const, name, contentBase64: candidate.contentBase64 }
      const content = decodeLegacyAttachment(legacy, remainingLegacyBytes)
      if (content) {
        remainingLegacyBytes -= content.length
        result.push(legacy)
      }
      continue
    }
    if (
      (candidate.kind !== undefined && candidate.kind !== 'text') ||
      typeof candidate.content !== 'string' ||
      remainingText <= 0
    ) {
      continue
    }
    const content = candidate.content.slice(0, remainingText)
    remainingText -= content.length
    result.push({ kind: 'text', name, content })
  }
  return result
}

function virtualDocumentPath(index: number, name: string): string {
  const safeName = name.replaceAll(/[\\/]/g, '_') || 'document'
  return `@attachments/${index + 1}-${safeName}`
}

export async function prepareTeamChatAttachments(args: {
  message: string
  attachments: TeamChatAttachment[]
  conversationId: string
  requestId: string
  artifactStore: HermesBinaryArtifactStore
}): Promise<{
  message: string
  documents: LocalDocumentAttachment[]
  images: PreparedTeamChatImageAttachment[]
  reusableArtifactIds: string[]
  ephemeralArtifactIds: string[]
}> {
  const blocks: string[] = []
  const documents: LocalDocumentAttachment[] = []
  const images: PreparedTeamChatImageAttachment[] = []
  const reusableArtifactIds: string[] = []
  const ephemeralArtifactIds: string[] = []
  try {
    for (const attachment of args.attachments) {
      if (attachment.kind === 'text') {
        blocks.push(`[첨부 파일: ${attachment.name}]\n${attachment.content}\n[첨부 파일 끝]`)
        continue
      }
      if (attachment.kind === 'image') {
        images.push({ source: 'clipboard', name: attachment.name, path: attachment.path })
        continue
      }
      const reusable = attachment.kind === 'artifact'
      const artifact = reusable
        ? args.artifactStore.bindMetadata(
            attachment.artifactId,
            args.conversationId,
            args.requestId
          )
        : await args.artifactStore.ingestBytes(
            attachment.name,
            decodeLegacyAttachment(attachment, MAX_DOCUMENT_ATTACHMENT_BYTES) ?? new Uint8Array(),
            args.conversationId
          )
      if (reusable) {
        reusableArtifactIds.push(artifact.artifactId)
      } else {
        ephemeralArtifactIds.push(artifact.artifactId)
      }
      if (artifact.artifactKind === 'png' || artifact.artifactKind === 'jpeg') {
        const path = virtualDocumentPath(documents.length, artifact.name)
        documents.push({ path, artifactId: artifact.artifactId })
        blocks.push(
          `[첨부 이미지: ${artifact.name}]\nOrca 문서 도구 경로: ${path}\n형식: ${artifact.artifactKind}\n[첨부 이미지 끝]`
        )
        images.push({
          source: 'artifact',
          name: artifact.name,
          artifactId: artifact.artifactId,
          artifactKind: artifact.artifactKind,
          conversationId: args.conversationId
        })
        continue
      }
      const path = virtualDocumentPath(documents.length, artifact.name)
      documents.push({ path, artifactId: artifact.artifactId })
      blocks.push(
        `[첨부 문서: ${artifact.name}]\nOrca 문서 도구 경로: ${path}\n형식: ${artifact.artifactKind}\n[첨부 문서 끝]`
      )
    }
    return {
      message:
        blocks.length > 0
          ? `${args.message}${args.message ? '\n\n' : ''}${blocks.join('\n\n')}`
          : args.message,
      documents,
      images,
      reusableArtifactIds,
      ephemeralArtifactIds
    }
  } catch (error) {
    args.artifactStore.releaseRequestBindings(
      reusableArtifactIds,
      args.conversationId,
      args.requestId
    )
    await args.artifactStore.cleanupMany(ephemeralArtifactIds)
    throw error
  }
}
