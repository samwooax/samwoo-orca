import type { SamwooWorkspaceFileEntry } from '../../shared/samwoo-workspace-sharing'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'

const MAX_FILES = 5_000
const MAX_REMOTE_ENTRIES = 10_000
const MAX_DIRECTORY_DEPTH = 64
const LARGE_RESPONSE_BYTES = 24 * 1024 * 1024

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

export async function listSamwooWorkspaceRemoteFiles(
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
      await listSamwooWorkspaceRemoteFiles(token, shareId, childPath, files, state, depth + 1)
    } else {
      files.push({ path: childPath, etag: entry.etag })
    }
    if (files.length > MAX_FILES) {
      throw new Error('Shared workspace contains too many files')
    }
  }
  return files
}

export async function readSamwooWorkspaceRemoteFile(
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

export async function deleteSamwooWorkspaceRemoteFile(
  token: string,
  shareId: string,
  filePath: string,
  expectedEtag: string
): Promise<'deleted' | 'conflict'> {
  const result = await postSamwooWorkspaceShare('/workspace-shares/files/delete', token, {
    shareId,
    path: filePath,
    expectedEtag
  })
  if (!result.ok && result.errorCode === 'file_conflict') {
    return 'conflict'
  }
  if (!result.ok) {
    throw new Error(result.error || `Could not delete ${filePath}`)
  }
  return 'deleted'
}
