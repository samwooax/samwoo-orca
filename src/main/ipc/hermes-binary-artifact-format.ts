import { extname } from 'node:path'
import { unzipSync } from 'fflate'
import type { HermesBinaryArtifactKind } from '../../shared/hermes-team-chat-attachments'

const MAX_ARCHIVE_ENTRIES = 4_096
const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_CONTENT_TYPES_BYTES = 2 * 1024 * 1024

function detectOoxmlKind(content: Uint8Array): 'xlsx' | 'pptx' {
  let entries = 0
  let expandedBytes = 0
  const archive = unzipSync(content, {
    filter: (entry) => {
      entries += 1
      expandedBytes += entry.originalSize
      const name = entry.name.replaceAll('\\', '/')
      if (
        entries > MAX_ARCHIVE_ENTRIES ||
        entry.originalSize > MAX_ARCHIVE_ENTRY_BYTES ||
        expandedBytes > MAX_ARCHIVE_TOTAL_BYTES ||
        name.startsWith('/') ||
        name.split('/').some((segment) => segment === '..' || segment === '')
      ) {
        throw new Error('Office archive exceeds safe limits')
      }
      return name === '[Content_Types].xml'
    }
  })
  const types = archive['[Content_Types].xml']
  if (!types || types.byteLength > MAX_CONTENT_TYPES_BYTES) {
    throw new Error('Office archive content types are missing or too large')
  }
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(types)
  if (/macroEnabled|vbaProject|activeX/i.test(xml)) {
    throw new Error('macro-enabled or ActiveX Office files are not supported')
  }
  if (xml.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) {
    return 'xlsx'
  }
  if (
    xml.includes(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
    )
  ) {
    return 'pptx'
  }
  throw new Error('ZIP content is not a supported XLSX or PPTX document')
}

export function detectArtifactKind(content: Uint8Array): HermesBinaryArtifactKind {
  if (new TextDecoder('ascii').decode(content.subarray(0, 5)) === '%PDF-') {
    return 'pdf'
  }
  if (content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47) {
    return 'png'
  }
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return 'jpeg'
  }
  if (content[0] === 0x50 && content[1] === 0x4b) {
    return detectOoxmlKind(content)
  }
  throw new Error('file content is not a supported PDF, Office document, or image')
}

export function artifactMimeType(kind: HermesBinaryArtifactKind): string {
  const values: Record<HermesBinaryArtifactKind, string> = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
    jpeg: 'image/jpeg'
  }
  return values[kind]
}

export function artifactExtensionMatches(name: string, kind: HermesBinaryArtifactKind): boolean {
  const extension = extname(name).toLowerCase()
  return kind === 'jpeg' ? ['.jpg', '.jpeg'].includes(extension) : extension === `.${kind}`
}
