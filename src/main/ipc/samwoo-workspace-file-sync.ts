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

const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_FILES = 5_000
const LARGE_RESPONSE_BYTES = 24 * 1024 * 1024
const EXCLUDED_DIRECTORIES = new Set(['.aws', '.git', '.gnupg', '.ssh', 'node_modules'])
const EXCLUDED_SECRET_FILES = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'id_dsa',
  'id_ed25519',
  'id_rsa'
])
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

function safeFolderName(value: string): string {
  const printable = [...value]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  const sanitized = printable
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
  return sanitized.slice(0, 120) || 'Shared workspace'
}

function isExcludedSecretFile(name: string): boolean {
  const lowerName = name.toLowerCase()
  const isEnvironmentSecret =
    (lowerName === '.env' || lowerName.startsWith('.env.')) &&
    !['.env.example', '.env.sample', '.env.template'].includes(lowerName)
  return (
    isEnvironmentSecret ||
    EXCLUDED_SECRET_FILES.has(lowerName) ||
    ['.key', '.p12', '.pem', '.pfx'].some((extension) => lowerName.endsWith(extension))
  )
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
  files: { path: string; etag: string }[] = []
): Promise<{ path: string; etag: string }[]> {
  for (const entry of await remoteEntries(token, shareId, relativePath)) {
    const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (entry.kind === 'directory') {
      await walkRemoteFiles(token, shareId, childPath, files)
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
    : path.join(path.resolve(args.destinationParent || ''), safeFolderName(args.folderName || ''))
  if (!args.destinationPath && (!args.destinationParent || !args.folderName)) {
    return { ok: false, error: 'download destination required' }
  }
  await fs.mkdir(rootPath, { recursive: true })
  const manifest = await readManifest(rootPath, args.shareId)
  const conflicts: string[] = []
  let transferredFiles = 0
  let skippedFiles = 0
  for (const remote of await walkRemoteFiles(args.token, args.shareId)) {
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
    transferredFiles += 1
  }
  await writeManifest(rootPath, manifest)
  return { ok: true, destinationPath: rootPath, transferredFiles, skippedFiles, conflicts }
}

async function walkLocalFiles(
  rootPath: string,
  relativePath = '',
  files: string[] = []
): Promise<string[]> {
  const directoryPath = relativePath ? path.join(rootPath, relativePath) : rootPath
  for (const entry of await fs.readdir(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue
    }
    const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isFile() && isExcludedSecretFile(entry.name)) {
      continue
    }
    if (entry.isDirectory()) {
      await walkLocalFiles(rootPath, childRelative, files)
    } else if (entry.isFile()) {
      files.push(childRelative)
    }
    if (files.length > MAX_FILES) {
      throw new Error('Workspace contains too many files')
    }
  }
  return files
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
  let transferredFiles = 0
  let skippedFiles = 0
  for (const platformRelative of await walkLocalFiles(rootPath)) {
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
        expectedEtag: manifest.files[remotePath]?.etag
      },
      LARGE_RESPONSE_BYTES
    )
    if (!result.ok || !result.file) {
      throw new Error(result.error || `Could not upload ${remotePath}`)
    }
    manifest.files[remotePath] = { etag: result.file.etag, hash }
    transferredFiles += 1
  }
  await writeManifest(rootPath, manifest)
  return { ok: true, destinationPath: rootPath, transferredFiles, skippedFiles, conflicts: [] }
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
