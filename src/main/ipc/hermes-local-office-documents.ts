import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { Store } from '../persistence'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import type {
  LocalDocumentAttachment,
  LocalDocumentOperation,
  LocalDocumentResult
} from './hermes-local-document-protocol'
import { runOfficeDocumentWorker } from './hermes-excel-artifact-worker-client'
import { resolveAuthorizedPath } from './filesystem-auth'

const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024

export type OfficeDocumentOperation = Extract<
  LocalDocumentOperation,
  { kind: 'create_pptx' | 'edit_pptx' | 'create_pdf' | 'edit_pdf' }
>
type EditOfficeDocumentOperation = Extract<
  OfficeDocumentOperation,
  { kind: 'edit_pptx' | 'edit_pdf' }
>

export function isOfficeDocumentOperation(
  operation: LocalDocumentOperation
): operation is OfficeDocumentOperation {
  return ['create_pptx', 'edit_pptx', 'create_pdf', 'edit_pdf'].includes(operation.kind)
}

function inside(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right)
}

function validateRelativePath(value: string): string {
  if (!value || value.includes('\0') || isAbsolute(value)) {
    throw new Error('invalid relative path')
  }
  const normalized = value.replaceAll('\\', '/')
  if (
    normalized
      .split('/')
      .some((segment) => segment === '..' || segment === '' || segment.toLowerCase() === '.git')
  ) {
    throw new Error('path traversal is not allowed')
  }
  return normalized
}

async function localRoot(cwd: string, store: Store): Promise<string> {
  const root = await resolveAuthorizedPath(cwd, store)
  if (!(await stat(root)).isDirectory()) {
    throw new Error('selected project root is not a directory')
  }
  return root
}

async function projectOutput(cwd: string, value: string, store: Store): Promise<string> {
  const root = await localRoot(cwd, store)
  const target = await resolveAuthorizedPath(resolve(root, validateRelativePath(value)), store)
  if (!inside(root, target)) {
    throw new Error('document output escapes the selected project')
  }
  return target
}

async function pickOutput(suggestedPath: string, format: 'pptx' | 'pdf'): Promise<string> {
  const options = {
    title: format === 'pptx' ? 'PowerPoint 파일 저장' : 'PDF 파일 저장',
    defaultPath: basename(suggestedPath),
    filters: [
      {
        name: format === 'pptx' ? 'PowerPoint presentation' : 'PDF document',
        extensions: [format]
      }
    ]
  }
  const window = BrowserWindow.getFocusedWindow()
  const selected = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (selected.canceled || !selected.filePath) {
    throw new Error('document save was cancelled')
  }
  if (extname(selected.filePath).toLowerCase() !== `.${format}`) {
    throw new Error(`document output must use the .${format} extension`)
  }
  return selected.filePath
}

async function createOnlyOutput(path: string, content: Uint8Array): Promise<void> {
  if (content.byteLength < 1 || content.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('document output exceeds the 64 MiB limit')
  }
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.orca-${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await link(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

function replaceArtifactPaths(value: unknown, artifactsByPath: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceArtifactPaths(item, artifactsByPath))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'artifactPath' && typeof item === 'string') {
      const artifactId = artifactsByPath.get(item)
      if (!artifactId) {
        throw new Error(`document artifact is unavailable: ${item}`)
      }
      result.artifactId = artifactId
    } else {
      result[key] = replaceArtifactPaths(item, artifactsByPath)
    }
  }
  return result
}

async function admittedArtifacts(args: {
  attachments: LocalDocumentAttachment[] | undefined
  artifactStore: HermesBinaryArtifactStore | undefined
  conversationId: string
  requestId: string
}): Promise<{
  byPath: Map<string, string>
  artifacts: { artifactId: string; path: string; sha256: string; sizeBytes: number }[]
}> {
  if (!args.attachments?.length) {
    return { byPath: new Map(), artifacts: [] }
  }
  if (!args.artifactStore) {
    throw new Error('document artifact store is unavailable')
  }
  return {
    byPath: new Map(args.attachments.map((item) => [item.path, item.artifactId])),
    artifacts: await Promise.all(
      args.attachments.map((item) =>
        args.artifactStore!.resolveForWorker(item.artifactId, args.conversationId, args.requestId)
      )
    )
  }
}

async function sourceIdentity(args: {
  cwd: string
  path: string
  store: Store
  attachments: LocalDocumentAttachment[] | undefined
  artifactStore: HermesBinaryArtifactStore | undefined
  conversationId: string
  requestId: string
}): Promise<{ path: string; sha256: string }> {
  const attachment = args.attachments?.find((item) => item.path === args.path)
  let path: string | undefined
  if (attachment) {
    path = (
      await args.artifactStore?.resolveForWorker(
        attachment.artifactId,
        args.conversationId,
        args.requestId
      )
    )?.path
  } else {
    const root = await localRoot(args.cwd, args.store)
    path = await resolveAuthorizedPath(resolve(root, validateRelativePath(args.path)), args.store)
    if (!inside(root, path)) {
      throw new Error('source document escapes the selected project')
    }
  }
  if (!path || !(await lstat(path)).isFile()) {
    throw new Error('source document is unavailable')
  }
  const content = await readFile(path)
  if (content.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('source document exceeds the 64 MiB limit')
  }
  return { path, sha256: createHash('sha256').update(content).digest('hex') }
}

export async function executeOfficeDocumentOperation(args: {
  cwd: string
  operation: OfficeDocumentOperation
  store: Store
  attachments: LocalDocumentAttachment[] | undefined
  artifactStore: HermesBinaryArtifactStore | undefined
  conversationId: string
  requestId: string
  allowNativeSave: boolean
}): Promise<LocalDocumentResult> {
  const format = args.operation.kind.endsWith('pptx') ? 'pptx' : 'pdf'
  if (extname(args.operation.outputPath).toLowerCase() !== `.${format}`) {
    throw new Error(`document output must use the .${format} extension`)
  }
  const output = args.allowNativeSave
    ? await pickOutput(args.operation.outputPath, format)
    : await projectOutput(args.cwd, args.operation.outputPath, args.store)
  await mkdir(dirname(output), { recursive: true })
  const staging = `${output}.orca-${randomUUID()}.tmp.${format}`
  const admitted = await admittedArtifacts(args)
  let source: { path: string; sha256: string } | undefined
  try {
    const documentRequest: Record<string, unknown> = {
      action: args.operation.kind,
      outputPath: staging,
      artifacts: admitted.artifacts
    }
    if (args.operation.kind === 'create_pptx' || args.operation.kind === 'create_pdf') {
      documentRequest.documentSpec = replaceArtifactPaths(
        args.operation.documentSpec,
        admitted.byPath
      )
    } else {
      const operation = args.operation as EditOfficeDocumentOperation
      source = await sourceIdentity({ ...args, path: operation.path })
      if (source.sha256 !== operation.expectedSha256 || samePath(source.path, output)) {
        throw new Error(`source ${format.toUpperCase()} changed or matches the output`)
      }
      documentRequest.sourcePath = source.path
      documentRequest.expectedSha256 = operation.expectedSha256
      documentRequest.operations = replaceArtifactPaths(operation.edits, admitted.byPath)
    }
    const processed = await runOfficeDocumentWorker(args.requestId, documentRequest)
    if (processed.ok !== true) {
      throw new Error('document worker could not produce an output')
    }
    const content = await readFile(staging)
    const outputHash = createHash('sha256').update(content).digest('hex')
    if (processed.sha256 !== outputHash) {
      throw new Error('document worker output failed integrity validation')
    }
    if (
      source &&
      createHash('sha256')
        .update(await readFile(source.path))
        .digest('hex') !== source.sha256
    ) {
      throw new Error(`source ${format.toUpperCase()} changed while edits were applied`)
    }
    await createOnlyOutput(output, content)
    return {
      id: args.operation.id,
      ok: true,
      ...('path' in args.operation ? { path: args.operation.path } : {}),
      outputPath: args.allowNativeSave ? basename(output) : args.operation.outputPath,
      format,
      sha256: outputHash,
      ...(typeof processed.slideCount === 'number' ? { slideCount: processed.slideCount } : {}),
      ...(typeof processed.pageCount === 'number' ? { pageCount: processed.pageCount } : {}),
      ...(typeof processed.appliedCount === 'number'
        ? { appliedCount: processed.appliedCount }
        : {})
    }
  } finally {
    await rm(staging, { force: true }).catch(() => {})
  }
}
