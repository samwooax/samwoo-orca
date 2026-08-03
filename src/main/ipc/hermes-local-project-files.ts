import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { Store } from '../persistence'
import { resolveAuthorizedPath } from './filesystem-auth'
import type {
  LocalFileOperation,
  LocalFileRequest,
  LocalFileResult
} from './hermes-local-file-protocol'

const MAX_FILE_BYTES = 512 * 1024
const MAX_RESULT_BYTES = 768 * 1024
const MAX_DIRECTORY_ENTRIES = 500

const projectQueues = new Map<string, Promise<void>>()

function validateRelativePath(value: string, allowRoot: boolean): string {
  if (!value || value.includes('\0') || isAbsolute(value)) {
    throw new Error('invalid relative path')
  }
  const normalized = value === '.' ? '.' : value.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..' || segment === '')) {
    throw new Error('path traversal is not allowed')
  }
  if (!allowRoot && normalized === '.') {
    throw new Error('a file path is required')
  }
  return normalized
}

function isInsideRoot(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

async function resolveProjectRoot(cwd: string, store: Store): Promise<string> {
  if (!cwd.trim()) {
    throw new Error('no local project is selected')
  }
  const root = await resolveAuthorizedPath(cwd, store)
  if (!(await stat(root)).isDirectory()) {
    throw new Error('selected project root is not a directory')
  }
  return root
}

async function resolveProjectPath(
  root: string,
  pathValue: string,
  store: Store,
  allowRoot = false
): Promise<{ path: string; relativePath: string }> {
  const relativePath = validateRelativePath(pathValue, allowRoot)
  const target = await resolveAuthorizedPath(resolve(root, relativePath), store)
  if (!isInsideRoot(root, target)) {
    throw new Error('path resolves outside the selected project')
  }
  return { path: target, relativePath }
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function requireUtf8Text(content: Buffer): void {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  if (text.includes('\0')) {
    throw new Error('binary files are not supported')
  }
}

function decodeContent(value: string): Buffer {
  const content = Buffer.from(value, 'base64')
  if (content.length > MAX_FILE_BYTES || content.toString('base64') !== value) {
    throw new Error('invalid or oversized file content')
  }
  requireUtf8Text(content)
  return content
}

async function listProjectPath(
  root: string,
  operation: Extract<LocalFileOperation, { kind: 'list' }>,
  store: Store
): Promise<LocalFileResult> {
  const target = await resolveProjectPath(root, operation.path, store, true)
  const entries = await readdir(target.path, { withFileTypes: true })
  if (entries.length > MAX_DIRECTORY_ENTRIES) {
    throw new Error(`directory exceeds ${MAX_DIRECTORY_ENTRIES} entries`)
  }
  return {
    id: operation.id,
    ok: true,
    path: target.relativePath,
    entries: entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isFile()
          ? ('file' as const)
          : entry.isDirectory()
            ? ('directory' as const)
            : ('other' as const)
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
}

async function readProjectPath(
  root: string,
  operation: Extract<LocalFileOperation, { kind: 'read' }>,
  store: Store
): Promise<LocalFileResult> {
  const target = await resolveProjectPath(root, operation.path, store)
  const info = await lstat(target.path)
  if (!info.isFile() || info.size > MAX_FILE_BYTES) {
    throw new Error('path is not a supported file')
  }
  const content = await readFile(target.path)
  requireUtf8Text(content)
  return {
    id: operation.id,
    ok: true,
    path: target.relativePath,
    contentBase64: content.toString('base64'),
    sha256: sha256(content)
  }
}

async function writeProjectPath(
  root: string,
  operation: Extract<LocalFileOperation, { kind: 'write' }>,
  store: Store
): Promise<LocalFileResult> {
  const target = await resolveProjectPath(root, operation.path, store)
  const content = decodeContent(operation.contentBase64)
  let current: Buffer | null = null
  try {
    current = await readFile(target.path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  if (
    current === null
      ? operation.expectedSha256 !== null
      : sha256(current) !== operation.expectedSha256
  ) {
    throw new Error('file changed or already exists; read it again before writing')
  }
  await mkdir(join(target.path, '..'), { recursive: true })
  if (current === null) {
    await writeFile(target.path, content, { flag: 'wx' })
    return {
      id: operation.id,
      ok: true,
      path: target.relativePath,
      sha256: sha256(content)
    }
  }
  const temporary = `${target.path}.orca-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { flag: 'wx' })
    if (sha256(await readFile(target.path)) !== operation.expectedSha256) {
      throw new Error('file changed; read it again before writing')
    }
    await rename(temporary, target.path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
  return {
    id: operation.id,
    ok: true,
    path: target.relativePath,
    sha256: sha256(content)
  }
}

async function executeOperation(
  root: string,
  operation: LocalFileOperation,
  store: Store
): Promise<LocalFileResult> {
  try {
    if (operation.kind === 'list') {
      return await listProjectPath(root, operation, store)
    }
    if (operation.kind === 'read') {
      return await readProjectPath(root, operation, store)
    }
    return await writeProjectPath(root, operation, store)
  } catch (error) {
    return {
      id: operation.id,
      ok: false,
      path: operation.path,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function runQueued<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(key) ?? Promise.resolve()
  let release = (): void => {}
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent
  })
  const queued = previous.then(() => current)
  projectQueues.set(key, queued)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (projectQueues.get(key) === queued) {
      projectQueues.delete(key)
    }
  }
}

export async function executeLocalFileRequest(args: {
  cwd: string
  request: LocalFileRequest
  store: Store
  onOperationStart?: (operation: LocalFileOperation) => void
  onOperationComplete?: (operation: LocalFileOperation, result: LocalFileResult) => void
}): Promise<LocalFileResult[]> {
  const root = await resolveProjectRoot(args.cwd, args.store)
  return runQueued(root, async () => {
    const results: LocalFileResult[] = []
    let resultBytes = 0
    for (const operation of args.request.operations) {
      args.onOperationStart?.(operation)
      const result = await executeOperation(root, operation, args.store)
      args.onOperationComplete?.(operation, result)
      resultBytes += Buffer.byteLength(JSON.stringify(result))
      if (resultBytes > MAX_RESULT_BYTES) {
        results.push({ id: operation.id, ok: false, error: 'local file results are too large' })
        break
      }
      results.push(result)
    }
    return results
  })
}
