import { lstat, stat } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve } from 'node:path'
import type { Store } from '../persistence'
import { isENOENT, resolveAuthorizedPath } from './filesystem-auth'
import {
  executeLocalFileRequest,
  LOCAL_PROJECT_MAX_FILE_BYTES,
  type LocalFileOverwriteSnapshot
} from './hermes-local-project-files'
import type { LocalFileResult } from './hermes-local-file-protocol'
import type { AcpJsonRecord } from './hermes-team-chat-acp-values'
import { HermesAcpFileBackupStore } from './hermes-team-chat-acp-file-backups'

const MAX_ACP_PATH_CHARS = 4096
const READ_OPERATION_ID = 'acp-read'
const WRITE_OPERATION_ID = 'acp-write'
const VIRTUAL_PROJECT_ROOT = '/workspace'
const WINDOWS_DEVICE_SEGMENT_RE =
  /^(?:aux|clock\$|con|conin\$|conout\$|nul|prn|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i
const PUBLIC_ERROR_PATTERNS = [
  /^(?:path|content) must be a string$/,
  /^(?:line|limit) must be a positive integer$/,
  /^ACP file path/,
  /^path (?:is not|resolves outside)/,
  /^symbolic links are not supported$/,
  /^read an existing file/,
  /^writing Git metadata/,
  /^file changed/,
  /^invalid (?:or oversized file content|relative path)$/,
  /^binary files are not supported$/,
  /^local file (?:operation failed|read returned|write returned)/,
  /^ACP filesystem method is not supported$/,
  /^ACP prompt was cancelled$/,
  /^Access denied:/
] as const

type ResolvedProjectFile = {
  absolutePath: string
  relativePath: string
}

function isInsideRoot(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

function requiredString(params: AcpJsonRecord, key: string): string {
  const value = params[key]
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`)
  }
  return value
}

function optionalPositiveInteger(params: AcpJsonRecord, key: string): number | undefined {
  const value = params[key]
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${key} must be a positive integer`)
  }
  return Number(value)
}

function requireSuccessfulResult(result: LocalFileResult | undefined): LocalFileResult {
  if (!result?.ok) {
    throw new Error(result?.error ?? 'local file operation failed')
  }
  return result
}

function publicFilesystemError(error: unknown): Error {
  const message = error instanceof Error ? error.message : ''
  return new Error(
    PUBLIC_ERROR_PATTERNS.some((pattern) => pattern.test(message))
      ? message
      : 'local filesystem operation failed'
  )
}

function sliceTextLines(content: string, line?: number, limit?: number): string {
  if (line === undefined && limit === undefined) {
    return content
  }
  const start = (line ?? 1) - 1
  return content
    .split('\n')
    .slice(start, limit === undefined ? undefined : start + limit)
    .join('\n')
}

function validateVirtualSegments(relativePath: string): string[] {
  const segments = relativePath.split('/')
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.includes(':') ||
        WINDOWS_DEVICE_SEGMENT_RE.test(segment) ||
        /[. ]$/.test(segment)
    )
  ) {
    throw new Error('ACP file path contains an unsupported segment')
  }
  return segments
}

async function rejectSymlinkSegments(root: string, segments: string[]): Promise<void> {
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error('symbolic links are not supported')
      }
    } catch (error) {
      if (isENOENT(error)) {
        return
      }
      throw error
    }
  }
}

export class HermesAcpFilesystem {
  private readonly revisions = new Map<string, string>()
  private readonly backups: HermesAcpFileBackupStore

  private constructor(
    private readonly projectRoot: string,
    private readonly store: Store,
    backupRoot: string
  ) {
    this.backups = new HermesAcpFileBackupStore(backupRoot, projectRoot)
  }

  static async create(args: {
    cwd: string
    store: Store
    backupRoot: string
  }): Promise<HermesAcpFilesystem> {
    const projectRoot = await resolveAuthorizedPath(args.cwd, args.store)
    if (!(await stat(projectRoot)).isDirectory()) {
      throw new Error('selected project root is not a directory')
    }
    return new HermesAcpFilesystem(projectRoot, args.store, args.backupRoot)
  }

  resetReadRevisions(): void {
    this.revisions.clear()
  }

  async handle(
    method: string,
    params: AcpJsonRecord,
    canCommit: () => boolean = () => true
  ): Promise<unknown> {
    try {
      if (method === 'fs/read_text_file') {
        return await this.readTextFile(params)
      }
      if (method === 'fs/write_text_file') {
        await this.writeTextFile(params, canCommit)
        return null
      }
      throw new Error('ACP filesystem method is not supported')
    } catch (error) {
      throw publicFilesystemError(error)
    }
  }

  private async resolveFile(pathValue: string): Promise<ResolvedProjectFile> {
    if (
      !pathValue ||
      pathValue.length > MAX_ACP_PATH_CHARS ||
      pathValue.includes('\0') ||
      pathValue.includes('\\') ||
      !posix.isAbsolute(pathValue)
    ) {
      throw new Error('ACP file paths must be absolute')
    }
    const normalizedPath = posix.normalize(pathValue)
    const virtualRelativePath = posix.relative(VIRTUAL_PROJECT_ROOT, normalizedPath)
    if (
      virtualRelativePath === '' ||
      virtualRelativePath.startsWith('..') ||
      posix.isAbsolute(virtualRelativePath)
    ) {
      throw new Error('path resolves outside the selected project')
    }
    const segments = validateVirtualSegments(virtualRelativePath)
    await rejectSymlinkSegments(this.projectRoot, segments)
    const absolutePath = await resolveAuthorizedPath(
      resolve(this.projectRoot, ...segments),
      this.store
    )
    await rejectSymlinkSegments(this.projectRoot, segments)
    if (!isInsideRoot(this.projectRoot, absolutePath) || absolutePath === this.projectRoot) {
      throw new Error('path resolves outside the selected project')
    }
    return { absolutePath, relativePath: relative(this.projectRoot, absolutePath) }
  }

  private async readTextFile(params: AcpJsonRecord): Promise<{ content: string }> {
    const target = await this.resolveFile(requiredString(params, 'path'))
    const info = await lstat(target.absolutePath)
    if (!info.isFile() || info.size > LOCAL_PROJECT_MAX_FILE_BYTES || info.nlink > 1) {
      throw new Error('path is not a supported file')
    }
    const line = optionalPositiveInteger(params, 'line')
    const limit = optionalPositiveInteger(params, 'limit')
    const [rawResult] = await executeLocalFileRequest({
      cwd: this.projectRoot,
      store: this.store,
      request: {
        version: 1,
        operations: [{ id: READ_OPERATION_ID, kind: 'read', path: target.relativePath }]
      }
    })
    const result = requireSuccessfulResult(rawResult)
    if (typeof result.contentBase64 !== 'string' || !result.sha256) {
      throw new Error('local file read returned an invalid result')
    }
    if (line === undefined && limit === undefined) {
      this.revisions.set(target.relativePath, result.sha256)
    }
    return {
      content: sliceTextLines(
        Buffer.from(result.contentBase64, 'base64').toString('utf8'),
        line,
        limit
      )
    }
  }

  private async writeTextFile(params: AcpJsonRecord, canCommit: () => boolean): Promise<void> {
    const target = await this.resolveFile(requiredString(params, 'path'))
    const content = requiredString(params, 'content')
    let expectedSha256: string | null = null
    try {
      const info = await lstat(target.absolutePath)
      if (!info.isFile()) {
        throw new Error('path is not a supported file')
      }
      if (info.size > LOCAL_PROJECT_MAX_FILE_BYTES || info.nlink > 1) {
        throw new Error('path is not a supported file')
      }
      expectedSha256 = this.revisions.get(target.relativePath) ?? null
      if (!expectedSha256) {
        throw new Error('read an existing file before overwriting it')
      }
    } catch (error) {
      if (!isENOENT(error)) {
        throw error
      }
    }

    const assertCanCommit = () => {
      if (!canCommit()) {
        throw new Error('ACP prompt was cancelled')
      }
    }
    const [rawResult] = await executeLocalFileRequest({
      cwd: this.projectRoot,
      store: this.store,
      request: {
        version: 1,
        operations: [
          {
            id: WRITE_OPERATION_ID,
            kind: 'write',
            path: target.relativePath,
            contentBase64: Buffer.from(content).toString('base64'),
            expectedSha256
          }
        ]
      },
      beforeOverwrite: async (snapshot) => {
        assertCanCommit()
        await this.backupBeforeOverwrite(snapshot)
      },
      beforeCommit: assertCanCommit
    })
    const result = requireSuccessfulResult(rawResult)
    if (!result.sha256) {
      throw new Error('local file write returned an invalid result')
    }
    this.revisions.set(target.relativePath, result.sha256)
  }

  private async backupBeforeOverwrite(snapshot: LocalFileOverwriteSnapshot): Promise<void> {
    await this.backups.write(snapshot)
  }
}
