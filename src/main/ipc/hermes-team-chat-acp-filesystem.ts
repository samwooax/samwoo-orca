import { lstat, stat } from 'node:fs/promises'
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
import type { HermesAcpOfficePreview } from './hermes-team-chat-acp-office-preview'
import {
  HERMES_ACP_MAX_OFFICE_DOCUMENT_BYTES,
  hermesAcpOfficeKind,
  renderHermesAcpOfficeFile
} from './hermes-team-chat-acp-office-file'
import { resolveHermesAcpProjectFile } from './hermes-team-chat-acp-file-path'

const READ_OPERATION_ID = 'acp-read'
const WRITE_OPERATION_ID = 'acp-write'
const NEVER_ABORTED_SIGNAL = new AbortController().signal
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
  /^office preview/,
  /^local file (?:operation failed|read returned|write returned)/,
  /^ACP filesystem method is not supported$/,
  /^ACP prompt was cancelled$/,
  /^file does not exist$/,
  /^Access denied:/
] as const

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

export class HermesAcpFilesystem {
  private readonly revisions = new Map<string, string>()
  private readonly backups: HermesAcpFileBackupStore

  private constructor(
    private readonly projectRoot: string,
    private readonly store: Store,
    backupRoot: string,
    private readonly officePreview: HermesAcpOfficePreview | null
  ) {
    this.backups = new HermesAcpFileBackupStore(backupRoot, projectRoot)
  }

  static async create(args: {
    cwd: string
    store: Store
    backupRoot: string
    officePreview?: HermesAcpOfficePreview | null
  }): Promise<HermesAcpFilesystem> {
    const projectRoot = await resolveAuthorizedPath(args.cwd, args.store)
    if (!(await stat(projectRoot)).isDirectory()) {
      throw new Error('selected project root is not a directory')
    }
    return new HermesAcpFilesystem(
      projectRoot,
      args.store,
      args.backupRoot,
      args.officePreview ?? null
    )
  }

  resetReadRevisions(): void {
    this.revisions.clear()
  }

  cancelActivePreviews(): void {
    this.officePreview?.cancelAll()
  }

  async handle(
    method: string,
    params: AcpJsonRecord,
    canCommit: () => boolean = () => true,
    signal: AbortSignal = NEVER_ABORTED_SIGNAL
  ): Promise<unknown> {
    try {
      const canContinue = () => !signal.aborted && canCommit()
      if (!canContinue()) {
        throw new Error('ACP prompt was cancelled')
      }
      if (method === 'fs/read_text_file') {
        return await this.readTextFile(params, signal)
      }
      if (method === 'fs/write_text_file') {
        await this.writeTextFile(params, canContinue)
        return null
      }
      throw new Error('ACP filesystem method is not supported')
    } catch (error) {
      throw publicFilesystemError(error)
    }
  }

  private async readTextFile(
    params: AcpJsonRecord,
    signal: AbortSignal
  ): Promise<{ content: string; _meta?: AcpJsonRecord }> {
    const target = await resolveHermesAcpProjectFile({
      pathValue: requiredString(params, 'path'),
      projectRoot: this.projectRoot,
      store: this.store
    })
    const info = await lstat(target.absolutePath).catch((error) => {
      if (isENOENT(error)) {
        throw new Error('file does not exist')
      }
      throw error
    })
    const officeKind = hermesAcpOfficeKind(target.absolutePath)
    const maxBytes = officeKind
      ? HERMES_ACP_MAX_OFFICE_DOCUMENT_BYTES
      : LOCAL_PROJECT_MAX_FILE_BYTES
    if (!info.isFile() || info.size > maxBytes || info.nlink > 1) {
      throw new Error('path is not a supported file')
    }
    const line = optionalPositiveInteger(params, 'line')
    const limit = optionalPositiveInteger(params, 'limit')
    if (officeKind) {
      return renderHermesAcpOfficeFile({
        preview: this.officePreview,
        params,
        sourcePath: target.absolutePath,
        kind: officeKind,
        startIndex: line,
        count: limit,
        signal
      })
    }
    const [rawResult] = await executeLocalFileRequest({
      cwd: this.projectRoot,
      store: this.store,
      request: {
        version: 1,
        operations: [{ id: READ_OPERATION_ID, kind: 'read', path: target.relativePath }]
      }
    })
    const result = requireSuccessfulResult(rawResult)
    if (signal.aborted) {
      throw new Error('ACP prompt was cancelled')
    }
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
    const target = await resolveHermesAcpProjectFile({
      pathValue: requiredString(params, 'path'),
      projectRoot: this.projectRoot,
      store: this.store
    })
    const content = requiredString(params, 'content')
    if (hermesAcpOfficeKind(target.absolutePath)) {
      throw new Error('office preview files cannot be written with the text file API')
    }
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
