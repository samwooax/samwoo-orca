import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  PreviewSamwooWorkspaceFilesArgs,
  SamwooWorkspaceChange,
  SamwooWorkspaceSyncPreview
} from '../../shared/samwoo-workspace-sharing'
import {
  listSamwooWorkspaceUploadFiles,
  safeSamwooWorkspaceFolderName
} from './samwoo-workspace-file-policy'
import { listSamwooWorkspaceRemoteFiles } from './samwoo-workspace-remote-files'
import {
  readSamwooWorkspaceManifest,
  samwooWorkspaceFileHash
} from './samwoo-workspace-sync-manifest'

const SHARE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function localHashes(rootPath: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  for (const platformPath of await listSamwooWorkspaceUploadFiles(rootPath)) {
    const remotePath = platformPath.split(path.sep).join('/')
    hashes.set(
      remotePath,
      samwooWorkspaceFileHash(await fs.readFile(path.join(rootPath, platformPath)))
    )
  }
  return hashes
}

function previewPull(
  local: Map<string, string>,
  remote: Map<string, string>,
  manifest: Awaited<ReturnType<typeof readSamwooWorkspaceManifest>>
): SamwooWorkspaceChange[] {
  const changes: SamwooWorkspaceChange[] = []
  for (const [filePath, remoteEtag] of remote) {
    const localHash = local.get(filePath)
    const previous = manifest.files[filePath]
    if (!previous) {
      changes.push({ path: filePath, kind: localHash ? 'conflict' : 'add', origin: 'remote' })
    } else if (!localHash) {
      changes.push({
        path: filePath,
        kind: 'conflict',
        origin: remoteEtag === previous.etag ? 'local' : 'both'
      })
    } else if (localHash !== previous.hash) {
      if (remoteEtag !== previous.etag) {
        changes.push({ path: filePath, kind: 'conflict', origin: 'both' })
      }
    } else if (remoteEtag !== previous.etag) {
      changes.push({ path: filePath, kind: 'modify', origin: 'remote' })
    }
  }
  for (const [filePath, previous] of Object.entries(manifest.files)) {
    if (remote.has(filePath)) {
      continue
    }
    const localHash = local.get(filePath)
    if (localHash) {
      changes.push({
        path: filePath,
        kind: localHash === previous.hash ? 'delete' : 'conflict',
        origin: localHash === previous.hash ? 'remote' : 'both'
      })
    }
  }
  return changes
}

function previewPush(
  local: Map<string, string>,
  remote: Map<string, string>,
  manifest: Awaited<ReturnType<typeof readSamwooWorkspaceManifest>>
): SamwooWorkspaceChange[] {
  const changes: SamwooWorkspaceChange[] = []
  for (const [filePath, localHash] of local) {
    const remoteEtag = remote.get(filePath)
    const previous = manifest.files[filePath]
    if (!previous) {
      changes.push({
        path: filePath,
        kind: remoteEtag ? 'conflict' : 'add',
        origin: remoteEtag ? 'both' : 'local'
      })
    } else if (!remoteEtag) {
      changes.push({
        path: filePath,
        kind: 'conflict',
        origin: localHash === previous.hash ? 'remote' : 'both'
      })
    } else if (localHash !== previous.hash) {
      changes.push({
        path: filePath,
        kind: remoteEtag === previous.etag ? 'modify' : 'conflict',
        origin: remoteEtag === previous.etag ? 'local' : 'both'
      })
    } else if (remoteEtag !== previous.etag) {
      changes.push({ path: filePath, kind: 'conflict', origin: 'remote' })
    }
  }
  for (const [filePath, previous] of Object.entries(manifest.files)) {
    if (local.has(filePath)) {
      continue
    }
    const remoteEtag = remote.get(filePath)
    if (remoteEtag) {
      changes.push({
        path: filePath,
        kind: remoteEtag === previous.etag ? 'delete' : 'conflict',
        origin: remoteEtag === previous.etag ? 'local' : 'both'
      })
    }
  }
  return changes
}

export async function previewSamwooWorkspaceFiles(
  args: PreviewSamwooWorkspaceFilesArgs
): Promise<SamwooWorkspaceSyncPreview> {
  if (
    typeof args?.token !== 'string' ||
    args.token.length < 20 ||
    !SHARE_ID_PATTERN.test(args.shareId) ||
    !['pull', 'push'].includes(args.direction)
  ) {
    return { ok: false, error: 'login required' }
  }
  const rootPath = args.localPath
    ? path.resolve(args.localPath)
    : path.join(
        path.resolve(args.destinationParent || ''),
        safeSamwooWorkspaceFolderName(args.folderName || '')
      )
  if (!args.localPath && (!args.destinationParent || !args.folderName)) {
    return { ok: false, error: 'workspace folder required' }
  }
  await fs.mkdir(rootPath, { recursive: true })
  const [manifest, local, remoteFiles] = await Promise.all([
    readSamwooWorkspaceManifest(rootPath, args.shareId),
    localHashes(rootPath),
    listSamwooWorkspaceRemoteFiles(args.token, args.shareId)
  ])
  const remote = new Map(remoteFiles.map((file) => [file.path, file.etag]))
  const changes =
    args.direction === 'pull'
      ? previewPull(local, remote, manifest)
      : previewPush(local, remote, manifest)
  return { ok: true, destinationPath: rootPath, changes }
}
