import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { Store } from '../persistence'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import type {
  LocalDocumentAttachment,
  LocalDocumentOperation,
  LocalDocumentResult
} from './hermes-local-document-protocol'
import { runLocalDocumentWorker } from './hermes-local-document-worker-client'
import type { OfficeDocumentOperation } from './hermes-local-office-documents'

const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024
type DocumentFormat = 'pdf' | 'xlsx' | 'pptx'
type TranslationOperation = Exclude<LocalDocumentOperation, OfficeDocumentOperation>

type SourceDocument = {
  content: Buffer
  format: DocumentFormat
  target: string | null
  hash: string
}

function documentFormat(path: string): DocumentFormat {
  const extension = extname(path).toLowerCase()
  if (extension === '.pdf' || extension === '.xlsx' || extension === '.pptx') {
    return extension.slice(1) as DocumentFormat
  }
  throw new Error('only PDF, XLSX, and PPTX documents are supported')
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

async function readDocument(args: {
  path: string
  attachments?: LocalDocumentAttachment[]
  artifactStore?: HermesBinaryArtifactStore
  conversationId: string
  requestId: string
  resolveProjectPath: (path: string) => Promise<string>
}): Promise<SourceDocument> {
  const attachment = args.attachments?.find((candidate) => candidate.path === args.path)
  if (attachment) {
    if (!args.artifactStore) {
      throw new Error('document artifact store is unavailable')
    }
    const content = await args.artifactStore.read(
      attachment.artifactId,
      args.conversationId,
      args.requestId
    )
    if (content.byteLength > MAX_DOCUMENT_BYTES) {
      throw new Error('document attachment exceeds the 64 MiB limit')
    }
    return { content, format: documentFormat(args.path), target: null, hash: sha256(content) }
  }
  const target = await args.resolveProjectPath(args.path)
  const info = await lstat(target)
  if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) {
    throw new Error('document is not a supported file or exceeds the 64 MiB limit')
  }
  const content = await readFile(target)
  return { content, format: documentFormat(args.path), target, hash: sha256(content) }
}

async function saveNewDocument(path: string, content: Uint8Array): Promise<void> {
  if (content.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('translated document exceeds the 64 MiB output limit')
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.orca-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { flag: 'wx' })
    await link(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function pickNewDocumentPath(suggestedPath: string, format: DocumentFormat): Promise<string> {
  const { BrowserWindow, dialog } = await import('electron')
  const formatName =
    format === 'xlsx'
      ? 'Excel workbook'
      : format === 'pptx'
        ? 'PowerPoint presentation'
        : 'PDF document'
  const options = {
    title: `Save ${formatName}`,
    defaultPath: basename(suggestedPath),
    filters: [{ name: formatName, extensions: [format] }]
  }
  const window = BrowserWindow.getFocusedWindow()
  const selected = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (selected.canceled || !selected.filePath) {
    throw new Error('translated document save was cancelled')
  }
  if (extname(selected.filePath).toLowerCase() !== `.${format}`) {
    throw new Error(`translated document must use the .${format} extension`)
  }
  return selected.filePath
}

export async function executeDocumentTranslationOperation(args: {
  operation: TranslationOperation
  store: Store
  attachments?: LocalDocumentAttachment[]
  artifactStore?: HermesBinaryArtifactStore
  conversationId: string
  requestId: string
  allowNativeSave: boolean
  resolveProjectPath: (path: string) => Promise<string>
}): Promise<LocalDocumentResult> {
  const { operation } = args
  const source = await readDocument({ path: operation.path, ...args })
  if (operation.kind === 'inspect' || operation.kind === 'extract') {
    const processed = await runLocalDocumentWorker(
      operation.kind === 'inspect'
        ? { kind: 'inspect', format: source.format, data: source.content }
        : {
            kind: 'extract',
            format: source.format,
            data: source.content,
            cursor: operation.cursor ?? 0,
            limit: operation.limit ?? 200
          },
      args.requestId
    )
    return { id: operation.id, ok: true, path: operation.path, sha256: source.hash, ...processed }
  }
  const expectedFormat = operation.kind === 'apply_xlsx_translation' ? 'xlsx' : 'pptx'
  if (
    source.format !== expectedFormat ||
    extname(operation.outputPath).toLowerCase() !== `.${expectedFormat}`
  ) {
    throw new Error(
      `translation application requires ${expectedFormat.toUpperCase()} input and output paths`
    )
  }
  if (source.hash !== operation.expectedSha256) {
    throw new Error(`source ${expectedFormat.toUpperCase()} changed; extract it again`)
  }
  const output = args.allowNativeSave
    ? await pickNewDocumentPath(operation.outputPath, expectedFormat)
    : await args.resolveProjectPath(operation.outputPath)
  if (source.target && output === source.target) {
    throw new Error('translated document must use a new output path')
  }
  const processed = await runLocalDocumentWorker(
    operation.kind === 'apply_xlsx_translation'
      ? {
          kind: 'apply_xlsx_translation',
          format: 'xlsx',
          data: source.content,
          translations: operation.translations
        }
      : {
          kind: 'apply_pptx_translation',
          format: 'pptx',
          data: source.content,
          translations: operation.translations
        },
    args.requestId
  )
  if (!processed.output) {
    throw new Error(`document worker did not return a ${expectedFormat.toUpperCase()} output`)
  }
  if (source.target && sha256(await readFile(source.target)) !== source.hash) {
    throw new Error(`source ${expectedFormat.toUpperCase()} changed during translation`)
  }
  await saveNewDocument(output, processed.output)
  return {
    id: operation.id,
    ok: true,
    path: operation.path,
    outputPath: args.allowNativeSave ? basename(output) : operation.outputPath,
    format: expectedFormat,
    sha256: source.hash,
    appliedCount: processed.appliedCount
  }
}
