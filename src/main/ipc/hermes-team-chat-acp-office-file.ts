import { extname } from 'node:path'
import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'
import {
  HERMES_ACP_OFFICE_PREVIEW_PREFIX,
  type HermesAcpOfficePreview
} from './hermes-team-chat-acp-office-preview'

export const HERMES_ACP_MAX_OFFICE_DOCUMENT_BYTES = 64 * 1024 * 1024

export function hermesAcpOfficeKind(path: string): 'xlsx' | 'pptx' | null {
  const extension = extname(path).toLowerCase()
  return extension === '.xlsx' ? 'xlsx' : extension === '.pptx' ? 'pptx' : null
}

function hasPreviewMetadata(params: AcpJsonRecord): boolean {
  const metadata = isAcpRecord(params._meta) ? params._meta : null
  const samwoo = metadata && isAcpRecord(metadata.samwoo) ? metadata.samwoo : null
  const preview = samwoo && isAcpRecord(samwoo.officePreview) ? samwoo.officePreview : null
  return Boolean(
    metadata &&
    samwoo &&
    preview?.version === 1 &&
    Object.keys(metadata).length === 1 &&
    Object.keys(samwoo).length === 1 &&
    Object.keys(preview).length === 1
  )
}

export async function renderHermesAcpOfficeFile(args: {
  preview: HermesAcpOfficePreview | null
  params: AcpJsonRecord
  sourcePath: string
  kind: 'xlsx' | 'pptx'
  startIndex?: number
  count?: number
  signal?: AbortSignal
}): Promise<{ content: string; _meta: AcpJsonRecord }> {
  if (!hasPreviewMetadata(args.params)) {
    throw new Error('office preview request metadata is invalid')
  }
  if (!args.preview) {
    throw new Error('office preview is unavailable')
  }
  const result = await args.preview.render({
    sourcePath: args.sourcePath,
    kind: args.kind,
    startIndex: args.startIndex,
    count: args.count,
    signal: args.signal
  })
  return {
    content: `${HERMES_ACP_OFFICE_PREVIEW_PREFIX}${JSON.stringify(result)}`,
    _meta: { samwoo: { kind: 'office-preview', version: 1 } }
  }
}
