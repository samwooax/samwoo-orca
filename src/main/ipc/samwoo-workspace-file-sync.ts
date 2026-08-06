import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ipcMain } from 'electron'
import type {
  PreviewSamwooWorkspaceFilesArgs,
  PullSamwooWorkspaceFilesArgs,
  PushSamwooWorkspaceFilesArgs,
  ResolveSamwooWorkspaceConflictsArgs,
  SamwooWorkspaceSyncResult
} from '../../shared/samwoo-workspace-sharing'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'
import { resolveSamwooWorkspaceConflicts } from './samwoo-workspace-conflict-resolution'
import {
  isSamwooWorkspacePathSupported,
  listSamwooWorkspaceUploadFiles,
  safeSamwooWorkspaceFolderName
} from './samwoo-workspace-file-policy'
import { previewSamwooWorkspaceFiles } from './samwoo-workspace-file-preview'
import {
  deleteSamwooWorkspaceRemoteFile,
  listSamwooWorkspaceRemoteFiles,
  readSamwooWorkspaceRemoteFile
} from './samwoo-workspace-remote-files'
import {
  readSamwooWorkspaceManifest,
  samwooWorkspaceFileHash,
  writeSamwooWorkspaceManifest
} from './samwoo-workspace-sync-manifest'

const MAX_FILE_BYTES = 16 * 1024 * 1024
const LARGE_RESPONSE_BYTES = 24 * 1024 * 1024
const SHARE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 256
}

function isShareId(value: unknown): value is string {
  return typeof value === 'string' && SHARE_ID_PATTERN.test(value)
}

function workspaceTargetPath(rootPath: string, remotePath: string): string {
  const targetPath = path.resolve(rootPath, ...remotePath.split('/'))
  if (targetPath === rootPath || !targetPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('Shared workspace returned an invalid file path')
  }
  return targetPath
}

function confirmedDeletePaths(value: unknown): Set<string> {
  if (value === undefined) {
    return new Set()
  }
  if (
    !Array.isArray(value) ||
    value.length > 5_000 ||
    value.some((item) => typeof item !== 'string')
  ) {
    throw new Error('invalid workspace deletion selection')
  }
  return new Set(value)
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
  const manifest = await readSamwooWorkspaceManifest(rootPath, args.shareId)
  const conflicts: string[] = []
  let transferredFiles = 0
  let skippedFiles = 0
  const remoteFiles = await listSamwooWorkspaceRemoteFiles(args.token, args.shareId)
  const remotePaths = new Set(remoteFiles.map((remote) => remote.path))
  for (const remote of remoteFiles) {
    if (!isSamwooWorkspacePathSupported(remote.path)) {
      conflicts.push(remote.path)
      continue
    }
    const targetPath = workspaceTargetPath(rootPath, remote.path)
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
    if (!existing && previous) {
      conflicts.push(remote.path)
      continue
    }
    if (existing && (!previous || samwooWorkspaceFileHash(existing) !== previous.hash)) {
      conflicts.push(remote.path)
      continue
    }
    const downloaded = await readSamwooWorkspaceRemoteFile(args.token, args.shareId, remote.path)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, downloaded.content)
    manifest.files[remote.path] = {
      etag: downloaded.etag || remote.etag,
      hash: samwooWorkspaceFileHash(downloaded.content)
    }
    // Why: a later download failure must not make completed files look locally untracked on retry.
    await writeSamwooWorkspaceManifest(rootPath, manifest)
    transferredFiles += 1
  }
  const confirmedDeletes = confirmedDeletePaths(args.deletePaths)
  for (const [remotePath, previous] of Object.entries(manifest.files)) {
    if (remotePaths.has(remotePath)) {
      continue
    }
    const targetPath = workspaceTargetPath(rootPath, remotePath)
    let existing: Buffer | null = null
    try {
      existing = await fs.readFile(targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    if (!existing) {
      delete manifest.files[remotePath]
    } else if (samwooWorkspaceFileHash(existing) !== previous.hash) {
      conflicts.push(remotePath)
    } else if (confirmedDeletes.has(remotePath)) {
      await fs.rm(targetPath)
      delete manifest.files[remotePath]
      transferredFiles += 1
    }
  }
  await writeSamwooWorkspaceManifest(rootPath, manifest)
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
  const manifest = await readSamwooWorkspaceManifest(rootPath, args.shareId)
  const remoteFiles = await listSamwooWorkspaceRemoteFiles(args.token, args.shareId)
  const remoteByPath = new Map(remoteFiles.map((remote) => [remote.path, remote]))
  const conflicts: string[] = []
  let transferredFiles = 0
  let skippedFiles = 0
  for (const platformRelative of await listSamwooWorkspaceUploadFiles(rootPath)) {
    const content = await fs.readFile(path.join(rootPath, platformRelative))
    if (content.length > MAX_FILE_BYTES) {
      throw new Error(`${platformRelative} exceeds 16 MiB`)
    }
    const remotePath = platformRelative.split(path.sep).join('/')
    const hash = samwooWorkspaceFileHash(content)
    const previous = manifest.files[remotePath]
    const remote = remoteByPath.get(remotePath)
    if (previous?.hash === hash && remote?.etag === previous.etag) {
      skippedFiles += 1
      continue
    }
    if (previous?.hash === hash || (previous && remote?.etag !== previous.etag)) {
      conflicts.push(remotePath)
      continue
    }
    const result = await postSamwooWorkspaceShare(
      '/workspace-shares/files/write',
      args.token,
      {
        shareId: args.shareId,
        path: remotePath,
        contentBase64: content.toString('base64'),
        expectedEtag: previous?.etag,
        createOnly: !previous
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
    await writeSamwooWorkspaceManifest(rootPath, manifest)
    transferredFiles += 1
  }
  const localPaths = new Set(
    (await listSamwooWorkspaceUploadFiles(rootPath)).map((entry) => entry.split(path.sep).join('/'))
  )
  const confirmedDeletes = confirmedDeletePaths(args.deletePaths)
  for (const [remotePath, previous] of Object.entries(manifest.files)) {
    if (localPaths.has(remotePath)) {
      continue
    }
    const remote = remoteByPath.get(remotePath)
    if (!remote) {
      delete manifest.files[remotePath]
      continue
    }
    if (remote.etag !== previous.etag || !confirmedDeletes.has(remotePath)) {
      if (remote.etag !== previous.etag) {
        conflicts.push(remotePath)
      }
      continue
    }
    const deleted = await deleteSamwooWorkspaceRemoteFile(
      args.token,
      args.shareId,
      remotePath,
      previous.etag
    )
    if (deleted === 'conflict') {
      conflicts.push(remotePath)
      continue
    }
    delete manifest.files[remotePath]
    await writeSamwooWorkspaceManifest(rootPath, manifest)
    transferredFiles += 1
  }
  return { ok: true, destinationPath: rootPath, transferredFiles, skippedFiles, conflicts }
}

function asFailure(error: unknown): SamwooWorkspaceSyncResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Workspace sync failed' }
}

export function registerSamwooWorkspaceFileSyncHandlers(): void {
  ipcMain.handle(
    'samwooWorkspaceShares:previewFiles',
    async (_event, args: PreviewSamwooWorkspaceFilesArgs) => {
      try {
        return await previewSamwooWorkspaceFiles(args)
      } catch (error) {
        return asFailure(error)
      }
    }
  )
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
  ipcMain.handle(
    'samwooWorkspaceShares:resolveConflicts',
    async (_event, args: ResolveSamwooWorkspaceConflictsArgs) => {
      try {
        return await resolveSamwooWorkspaceConflicts(args)
      } catch (error) {
        return asFailure(error)
      }
    }
  )
}
