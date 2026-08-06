import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  ResolveSamwooWorkspaceConflictsArgs,
  SamwooWorkspaceSyncResult
} from '../../shared/samwoo-workspace-sharing'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'
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

const LARGE_RESPONSE_BYTES = 24 * 1024 * 1024
const SHARE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function localTarget(rootPath: string, remotePath: string): string {
  const target = path.resolve(rootPath, ...remotePath.split('/'))
  if (target === rootPath || !target.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('Shared workspace returned an invalid file path')
  }
  return target
}

async function readLocalFile(targetPath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function forceUpload(
  args: ResolveSamwooWorkspaceConflictsArgs,
  remotePath: string,
  content: Buffer,
  createOnly = false
): Promise<{ etag: string } | null> {
  const result = await postSamwooWorkspaceShare(
    '/workspace-shares/files/write',
    args.token,
    {
      shareId: args.shareId,
      path: remotePath,
      contentBase64: content.toString('base64'),
      createOnly
    },
    LARGE_RESPONSE_BYTES
  )
  if (result.ok && result.file) {
    return { etag: result.file.etag }
  }
  if (result.errorCode === 'file_conflict') {
    return null
  }
  throw new Error(result.error || `Could not upload ${remotePath}`)
}

async function applyRemoteVersion(
  args: ResolveSamwooWorkspaceConflictsArgs,
  remotePath: string,
  remoteExists: boolean,
  rootPath: string,
  manifest: Awaited<ReturnType<typeof readSamwooWorkspaceManifest>>
): Promise<void> {
  const target = localTarget(rootPath, remotePath)
  if (!remoteExists) {
    await fs.rm(target, { force: true })
    delete manifest.files[remotePath]
    return
  }
  const downloaded = await readSamwooWorkspaceRemoteFile(args.token, args.shareId, remotePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, downloaded.content)
  manifest.files[remotePath] = {
    etag: downloaded.etag,
    hash: samwooWorkspaceFileHash(downloaded.content)
  }
}

function conflictCopyPath(remotePath: string): string {
  const parsed = path.posix.parse(remotePath)
  return path.posix.join(
    parsed.dir,
    `${parsed.name}.local-${new Date().toISOString().replace(/[:.]/g, '-')}${parsed.ext}`
  )
}

export async function resolveSamwooWorkspaceConflicts(
  args: ResolveSamwooWorkspaceConflictsArgs
): Promise<SamwooWorkspaceSyncResult> {
  if (
    typeof args?.token !== 'string' ||
    args.token.length < 20 ||
    !SHARE_ID_PATTERN.test(args.shareId) ||
    !['pull', 'push'].includes(args.direction) ||
    !Array.isArray(args.resolutions) ||
    args.resolutions.length > 5_000 ||
    args.resolutions.some(
      (resolution) =>
        typeof resolution?.path !== 'string' ||
        !['keep_local', 'use_remote', 'keep_both'].includes(resolution.choice)
    )
  ) {
    return { ok: false, error: 'login required' }
  }
  const rootPath = path.resolve(args.localPath || '')
  const manifest = await readSamwooWorkspaceManifest(rootPath, args.shareId)
  const remoteFiles = await listSamwooWorkspaceRemoteFiles(args.token, args.shareId)
  const remoteByPath = new Map(remoteFiles.map((file) => [file.path, file.etag]))
  const conflicts: string[] = []
  let transferredFiles = 0

  for (const resolution of args.resolutions) {
    const target = localTarget(rootPath, resolution.path)
    const content = await readLocalFile(target)
    const remoteEtag = remoteByPath.get(resolution.path)
    if (resolution.choice === 'use_remote') {
      await applyRemoteVersion(args, resolution.path, Boolean(remoteEtag), rootPath, manifest)
      transferredFiles += 1
    } else if (resolution.choice === 'keep_local') {
      if (content) {
        const uploaded = await forceUpload(args, resolution.path, content)
        if (!uploaded) {
          conflicts.push(resolution.path)
          continue
        }
        manifest.files[resolution.path] = {
          etag: uploaded.etag,
          hash: samwooWorkspaceFileHash(content)
        }
      } else if (remoteEtag) {
        const deleted = await deleteSamwooWorkspaceRemoteFile(
          args.token,
          args.shareId,
          resolution.path,
          remoteEtag
        )
        if (deleted === 'conflict') {
          conflicts.push(resolution.path)
          continue
        }
        delete manifest.files[resolution.path]
      }
      transferredFiles += 1
    } else {
      if (content) {
        const copyPath = conflictCopyPath(resolution.path)
        const uploaded = await forceUpload(args, copyPath, content, true)
        if (!uploaded) {
          conflicts.push(resolution.path)
          continue
        }
        const copyTarget = localTarget(rootPath, copyPath)
        await fs.mkdir(path.dirname(copyTarget), { recursive: true })
        await fs.rename(target, copyTarget)
        manifest.files[copyPath] = {
          etag: uploaded.etag,
          hash: samwooWorkspaceFileHash(content)
        }
        // Why: preserve the successful copy if fetching the canonical cloud version fails next.
        await writeSamwooWorkspaceManifest(rootPath, manifest)
      }
      await applyRemoteVersion(args, resolution.path, Boolean(remoteEtag), rootPath, manifest)
      transferredFiles += 1
    }
    await writeSamwooWorkspaceManifest(rootPath, manifest)
  }
  return { ok: true, destinationPath: rootPath, transferredFiles, conflicts }
}
