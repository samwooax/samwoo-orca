import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalFileOverwriteSnapshot } from './hermes-local-project-files'

const MAX_BACKUPS_PER_FILE = 20
const MAX_PROJECT_BACKUP_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_BACKUP_BYTES = 512 * 1024 * 1024
const MAX_BACKUP_AGE_MS = 30 * 24 * 60 * 60 * 1000
const backupWriteQueues = new Map<string, Promise<void>>()

type BackupEntry = {
  path: string
  mtimeMs: number
  size: number
}

async function collectBackups(directory: string, entries: BackupEntry[]): Promise<void> {
  const children = await readdir(directory, { withFileTypes: true })
  for (const child of children) {
    if (child.isSymbolicLink()) {
      continue
    }
    const path = join(directory, child.name)
    if (child.isDirectory()) {
      await collectBackups(path, entries)
    } else if (child.isFile() && child.name.endsWith('.bak')) {
      const info = await stat(path)
      entries.push({ path, mtimeMs: info.mtimeMs, size: info.size })
    }
  }
}

async function pruneFileHistory(directory: string, maxEntries: number): Promise<void> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.bak'))
    .sort((a, b) => b.localeCompare(a))
  for (const name of names.slice(maxEntries)) {
    await rm(join(directory, name))
  }
}

async function pruneHistory(root: string, maxBytes: number): Promise<void> {
  const entries: BackupEntry[] = []
  await collectBackups(root, entries)
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const oldestAllowed = Date.now() - MAX_BACKUP_AGE_MS
  let retainedBytes = 0
  for (const entry of entries) {
    retainedBytes += entry.size
    if (entry.mtimeMs < oldestAllowed || retainedBytes > maxBytes) {
      await rm(entry.path, { force: true })
    }
  }
}

async function runBackupWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = backupWriteQueues.get(key) ?? Promise.resolve()
  let release = (): void => {}
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent
  })
  const queued = previous.then(() => current)
  backupWriteQueues.set(key, queued)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (backupWriteQueues.get(key) === queued) {
      backupWriteQueues.delete(key)
    }
  }
}

export class HermesAcpFileBackupStore {
  private readonly projectBackupRoot: string

  constructor(
    private readonly backupRoot: string,
    projectRoot: string
  ) {
    const projectKey = createHash('sha256').update(projectRoot).digest('hex').slice(0, 24)
    this.projectBackupRoot = join(backupRoot, projectKey)
  }

  async write(snapshot: LocalFileOverwriteSnapshot): Promise<void> {
    return runBackupWrite(this.backupRoot, () => this.writeBackup(snapshot))
  }

  private async writeBackup(snapshot: LocalFileOverwriteSnapshot): Promise<void> {
    await mkdir(this.backupRoot, { recursive: true, mode: 0o700 })
    await chmod(this.backupRoot, 0o700).catch(() => {})
    await mkdir(this.projectBackupRoot, { recursive: true, mode: 0o700 })
    await chmod(this.projectBackupRoot, 0o700).catch(() => {})
    const directory = join(this.projectBackupRoot, snapshot.relativePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await pruneFileHistory(directory, MAX_BACKUPS_PER_FILE - 1)
    await pruneHistory(
      this.projectBackupRoot,
      Math.max(0, MAX_PROJECT_BACKUP_BYTES - snapshot.content.length)
    )
    await pruneHistory(
      this.backupRoot,
      Math.max(0, MAX_TOTAL_BACKUP_BYTES - snapshot.content.length)
    )
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const path = join(directory, `${timestamp}-${randomUUID()}.bak`)
    await writeFile(path, snapshot.content, { flag: 'wx', mode: 0o600 })
  }
}
