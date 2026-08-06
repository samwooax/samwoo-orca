import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import type {
  PullSamwooWorkspaceFilesArgs,
  PushSamwooWorkspaceFilesArgs,
  SamwooWorkspaceFileEntry,
  SamwooWorkspaceSyncResult
} from '../../shared/samwoo-workspace-sharing'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'
import {
  isSamwooWorkspacePathSupported,
  listSamwooWorkspaceUploadFiles,
  safeSamwooWorkspaceFolderName
} from './samwoo-workspace-file-policy'

const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_FILES = 5_000
const MAX_REMOTE_ENTRIES = 10_000
const MAX_DIRECTORY_DEPTH = 64
const LARGE_RESPONSE_BYTES = 24 * 1024 * 1024
const SHARE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ManifestEntry = { etag: string; hash: string }
type WorkspaceManifest = { version: 1; shareId: string; files: Record<string, ManifestEntry> }

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 256
}

function isShareId(value: unknown): value is string {
  return typeof value === 'string' && SHARE_ID_PATTERN.test(value)
}

function fileHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function manifestPath(rootPath: string, shareId: string): string {
  const rootKey = createHash('sha256').update(path.resolve(rootPath)).digest('hex').slice(0, 24)
  return path.join(app.getPath('userData'), 'samwoo-workspace-sync', `${shareId}-${rootKey}.json`)
}

async function readManifest(rootPath: string, shareId: string): Promise<WorkspaceManifest> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(manifestPath(rootPath, shareId), 'utf8')
    ) as WorkspaceManifest
    if (parsed.version === 1 && parsed.shareId === shareId && parsed.files) {
      return parsed
    }
  } catch {
    // Why: a missing or damaged manifest must not grant overwrite authority over local files.
  }
  return { version: 1, shareId, files: {} }
}

async function writeManifest(rootPath: string, manifest: WorkspaceManifest): Promise<void> {
  const targetPath = manifestPath(rootPath, manifest.shareId)
  await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 })
  await fs.writeFile(targetPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
}

async function remoteEntries(
  token: string,
  shareId: string,
  relativePath = ''
): Promise<SamwooWorkspaceFileEntry[]> {
  const result = await postSamwooWorkspaceShare('/workspace-shares/files/list', token, {
    shareId,
    path: relativePath
  })
  if (!result.ok) {
    throw new Error(result.error || 'Could not list shared workspace files')
  }
  return result.entries ?? []
}

async function walkRemoteFiles(
  token: string,
  shareId: string,
  relativePath = '',
  files: { path: string; etag: string }[] = [],
  state = { entries: 0 },
  depth = 0
): Promise<{ path: string; etag: string }[]> {
  if (depth > MAX_DIRECTORY_DEPTH) {
    throw new Error('Shared workspace directory nesting is too deep')
  }
  for (const entry of await remoteEntries(token, shareId, relativePath)) {
    state.entries += 1
    if (state.entries > MAX_REMOTE_ENTRIES) {
      throw new Error('Shared workspace contains too many entries')
    }
    const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (entry.kind === 'directory') {
      await walkRemoteFiles(token, shareId, childPath, files, state, depth + 1)
    } else {
      files.push({ path: childPath, etag: entry.etag })
    }
    if (files.length > MAX_FILES) {
      throw new Error('Shared workspace contains too many files')
    }
  }
  return files
}

async function readRemoteFile(
  token: string,
  shareId: string,
  filePath: string
): Promise<{ content: Buffer; etag: string }> {
  const result = await postSamwooWorkspaceShare(
    '/workspace-shares/files/read',
    token,
    { shareId, path: filePath },
    LARGE_RESPONSE_BYTES
  )
  if (!result.ok || !result.file) {
    throw new Error(result.error || `Could not read ${filePath}`)
  }
  return { content: Buffer.from(result.file.contentBase64, 'base64'), etag: result.file.etag }
}

export async function pullSamwooWorkspaceFiles(
  args: PullSamwooWorkspaceFilesArgs
): Promise<SamwooWorkspaceSyncResult> {
  if (!isToken(args?.token) || !isShareId(args.shareId)) {
    return { ok: false, error: 'login required' }
  }
  const rootPath = args.destinationPath
    ? path.resolve(args.destinationPath)
    : path.join(
        path.resolve(args.destinationParent || ''),
        safeSamwooWorkspaceFolderName(args.folderName || '')
      )
  if (!args.destinationPath && (!args.destinationParent || !args.folderName)) {
    return { ok: false, error: 'download destination required' }
  }
  await fs.mkdir(rootPath, { recursive: true })
  const manifest = await readManifest(rootPath, args.shareId)
  const conflicts: string[] = []
  let transferredFiles = 0
  let skippedFiles = 0
  for (const remote of await walkRemoteFiles(args.token, args.shareId)) {
    if (!isSamwooWorkspacePathSupported(remote.path)) {
      conflicts.push(remote.path)
      continue
    }
    const targetPath = path.resolve(rootPath, ...remote.path.split('/'))
    if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error('Shared workspace returned an invalid file path')
    }
    const previous = manifest.files[remote.path]
    let existing: Buffer | null = null
    try {
      existing = await fs.readFile(targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    if (existing && previous?.etag === remote.etag) {
      skippedFiles += 1
      continue
    }
    if (existing && (!previous || fileHash(existing) !== previous.hash)) {
      conflicts.push(remote.path)
      continue
    }
    const downloaded = await readRemoteFile(args.token, args.shareId, remote.path)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, downloaded.content)
    manifest.files[remote.path] = {
      etag: downloaded.etag || remote.etag,
      hash: fileHash(downloaded.content)
    }
    // Why: a later download failure must not make completed files look locally untracked on retry.
    await writeManifest(rootPath, manifest)
    transferredFiles += 1
  }
  await writeManifest(rootPath, manifest)
  return { ok: true, destinationPath: rootPath, transferredFiles, skippedFiles, conflicts }
}

export async function pushSamwooWorkspaceFiles(
  args: PushSamwooWorkspaceFilesArgs
): Promise<SamwooWorkspaceSyncResult> {
  if (!isToken(args?.token) || !isShareId(args.shareId)) {
    return { ok: false, error: 'login required' }
  }
  const rootPath = path.resolve(args.sourcePath || '')
  if (!args.sourcePath || !(await fs.stat(rootPath)).isDirectory()) {
    return { ok: false, error: 'workspace folder required' }
  }
  const manifest = await readManifest(rootPath, args.shareId)
  const conflicts: string[] = []
  let transferredFiles = 0
  let skippedFiles = 0
  for (const platformRelative of await listSamwooWorkspaceUploadFiles(rootPath)) {
    const content = await fs.readFile(path.join(rootPath, platformRelative))
    if (content.length > MAX_FILE_BYTES) {
      throw new Error(`${platformRelative} exceeds 16 MiB`)
    }
    const remotePath = platformRelative.split(path.sep).join('/')
    const hash = fileHash(content)
    if (manifest.files[remotePath]?.hash === hash) {
      skippedFiles += 1
      continue
    }
    const result = await postSamwooWorkspaceShare(
      '/workspace-shares/files/write',
      args.token,
      {
        shareId: args.shareId,
        path: remotePath,
        contentBase64: content.toString('base64'),
        expectedEtag: manifest.files[remotePath]?.etag,
        createOnly: !manifest.files[remotePath]
      },
      LARGE_RESPONSE_BYTES
    )
    if (!result.ok && result.errorCode === 'file_conflict') {
      conflicts.push(remotePath)
      continue
    }
    if (!result.ok || !result.file) {
      throw new Error(result.error || `Could not upload ${remotePath}`)
    }
    manifest.files[remotePath] = { etag: result.file.etag, hash }
    // Why: persisting each success prevents a later failure from making retries overwrite it.
    await writeManifest(rootPath, manifest)
    transferredFiles += 1
  }
  return { ok: true, destinationPath: rootPath, transferredFiles, skippedFiles, conflicts }
}

function asFailure(error: unknown): SamwooWorkspaceSyncResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Workspace sync failed' }
}

export function registerSamwooWorkspaceFileSyncHandlers(): void {
  ipcMain.handle(
    'samwooWorkspaceShares:pullFiles',
    async (_event, args: PullSamwooWorkspaceFilesArgs) => {
      try {
        return await pullSamwooWorkspaceFiles(args)
      } catch (error) {
        return asFailure(error)
      }
    }
  )
  ipcMain.handle(
    'samwooWorkspaceShares:pushFiles',
    async (_event, args: PushSamwooWorkspaceFilesArgs) => {
      try {
        return await pushSamwooWorkspaceFiles(args)
      } catch (error) {
        return asFailure(error)
      }
    }
  )
}
