import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'
import type { TeamChatArtifactAttachment } from '../../shared/hermes-team-chat-attachments'
import {
  artifactExtensionMatches,
  artifactMimeType,
  detectArtifactKind
} from './hermes-binary-artifact-format'

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const ARTIFACT_TTL_MS = 60 * 60 * 1_000

type ArtifactRecord = TeamChatArtifactAttachment & {
  conversationId: string
  requestId: string | null
  path: string
  expiresAt: number
}

function safeDisplayName(value: string): string {
  const name = [...basename(value)]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x1f && codePoint !== 0x7f
    })
    .join('')
    .slice(0, 255)
  if (!name || name === '.' || name === '..') {
    throw new Error('artifact filename is invalid')
  }
  return name
}

function isInside(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset !== '' && !offset.startsWith('..') && !isAbsolute(offset)
}

async function copyAndHash(
  sourcePath: string,
  targetPath: string
): Promise<{
  sizeBytes: number
  sha256: string
}> {
  const pathIdentity = await lstat(sourcePath)
  if (!pathIdentity.isFile() || pathIdentity.isSymbolicLink()) {
    throw new Error('artifact source must be a regular file')
  }
  const sourceBefore = await open(sourcePath, constants.O_RDONLY)
  const target = await open(targetPath, 'wx', 0o600)
  try {
    const before = await sourceBefore.stat()
    if (
      !before.isFile() ||
      before.size !== pathIdentity.size ||
      before.mtimeMs !== pathIdentity.mtimeMs ||
      (pathIdentity.ino !== 0 && before.ino !== pathIdentity.ino) ||
      before.size < 1 ||
      before.size > MAX_ARTIFACT_BYTES
    ) {
      throw new Error('artifact is empty or exceeds the 64 MiB limit')
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(256 * 1024)
    let total = 0
    while (total < before.size) {
      const { bytesRead } = await sourceBefore.read(buffer, 0, buffer.length, total)
      if (bytesRead === 0) {
        break
      }
      total += bytesRead
      if (total > MAX_ARTIFACT_BYTES) {
        throw new Error('artifact exceeds the 64 MiB limit')
      }
      hash.update(buffer.subarray(0, bytesRead))
      await target.write(buffer, 0, bytesRead, total - bytesRead)
    }
    const after = await sourceBefore.stat()
    if (
      total !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      (before.ino !== 0 && after.ino !== before.ino)
    ) {
      throw new Error('artifact changed while it was being admitted')
    }
    await target.sync()
    return { sizeBytes: total, sha256: hash.digest('hex') }
  } finally {
    await Promise.allSettled([sourceBefore.close(), target.close()])
  }
}

export class HermesBinaryArtifactStore {
  private readonly records = new Map<string, ArtifactRecord>()
  private readonly sweepTimer: ReturnType<typeof setInterval>
  private readonly ready: Promise<void>

  constructor(private readonly root: string) {
    this.ready = this.prepareRoot()
    this.sweepTimer = setInterval(() => void this.cleanupExpired(), 5 * 60 * 1_000)
    this.sweepTimer.unref?.()
  }

  async ingestFile(
    sourcePath: string,
    conversationId: string
  ): Promise<TeamChatArtifactAttachment> {
    await this.ready
    const artifactId = `artifact-${randomUUID()}`
    const directory = join(this.root, artifactId)
    const targetPath = join(directory, 'payload')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await mkdir(directory, { recursive: false, mode: 0o700 })
    try {
      const identity = await copyAndHash(sourcePath, targetPath)
      const content = await readFile(targetPath)
      const artifactKind = detectArtifactKind(content)
      const name = safeDisplayName(sourcePath)
      if (!artifactExtensionMatches(name, artifactKind)) {
        throw new Error('artifact extension does not match its file signature')
      }
      const record: ArtifactRecord = {
        kind: 'artifact',
        artifactId,
        name,
        artifactKind,
        mimeType: artifactMimeType(artifactKind),
        ...identity,
        conversationId,
        requestId: null,
        path: targetPath,
        expiresAt: Date.now() + ARTIFACT_TTL_MS
      }
      this.records.set(artifactId, record)
      return this.publicMetadata(record)
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async ingestBytes(
    name: string,
    content: Uint8Array,
    conversationId: string
  ): Promise<TeamChatArtifactAttachment> {
    await this.ready
    if (content.byteLength < 1 || content.byteLength > MAX_ARTIFACT_BYTES) {
      throw new Error('artifact is empty or exceeds the 64 MiB limit')
    }
    const artifactId = `artifact-${randomUUID()}`
    const directory = join(this.root, artifactId)
    const targetPath = join(directory, 'payload')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await mkdir(directory, { recursive: false, mode: 0o700 })
    try {
      const target = await open(targetPath, 'wx', 0o600)
      try {
        await target.writeFile(content)
        await target.sync()
      } finally {
        await target.close()
      }
      const artifactKind = detectArtifactKind(content)
      const safeName = safeDisplayName(name)
      if (!artifactExtensionMatches(safeName, artifactKind)) {
        throw new Error('artifact extension does not match its file signature')
      }
      const record: ArtifactRecord = {
        kind: 'artifact',
        artifactId,
        name: safeName,
        artifactKind,
        mimeType: artifactMimeType(artifactKind),
        sizeBytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
        conversationId,
        requestId: null,
        path: targetPath,
        expiresAt: Date.now() + ARTIFACT_TTL_MS
      }
      this.records.set(artifactId, record)
      return this.publicMetadata(record)
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  bind(artifactId: string, conversationId: string, requestId: string): ArtifactRecord {
    const record = this.authorizedRecord(artifactId, conversationId)
    if (record.requestId && record.requestId !== requestId) {
      throw new Error('artifact is already bound to another request')
    }
    record.requestId = requestId
    record.expiresAt = Date.now() + ARTIFACT_TTL_MS
    return record
  }

  bindMetadata(
    artifactId: string,
    conversationId: string,
    requestId: string
  ): TeamChatArtifactAttachment {
    return this.publicMetadata(this.bind(artifactId, conversationId, requestId))
  }

  async read(artifactId: string, conversationId: string, requestId: string): Promise<Buffer> {
    const record = this.bind(artifactId, conversationId, requestId)
    const content = await readFile(record.path)
    const hash = createHash('sha256').update(content).digest('hex')
    if (content.byteLength !== record.sizeBytes || hash !== record.sha256) {
      throw new Error('artifact identity changed after admission')
    }
    return content
  }

  async resolveForWorker(
    artifactId: string,
    conversationId: string,
    requestId: string
  ): Promise<{ artifactId: string; path: string; sha256: string; sizeBytes: number }> {
    const record = this.bind(artifactId, conversationId, requestId)
    const content = await readFile(record.path)
    const hash = createHash('sha256').update(content).digest('hex')
    if (content.byteLength !== record.sizeBytes || hash !== record.sha256) {
      throw new Error('artifact identity changed after admission')
    }
    return {
      artifactId: record.artifactId,
      path: record.path,
      sha256: record.sha256,
      sizeBytes: record.sizeBytes
    }
  }

  pathForImage(artifactId: string, conversationId: string, requestId: string): string {
    const record = this.bind(artifactId, conversationId, requestId)
    if (record.artifactKind !== 'png' && record.artifactKind !== 'jpeg') {
      throw new Error('artifact is not an image')
    }
    return record.path
  }

  async cleanup(artifactId: string): Promise<void> {
    const record = this.records.get(artifactId)
    if (!record) {
      return
    }
    this.records.delete(artifactId)
    const directory = join(this.root, artifactId)
    if (isInside(this.root, directory)) {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async release(artifactId: string, conversationId: string): Promise<boolean> {
    const record = this.records.get(artifactId)
    if (!record || record.conversationId !== conversationId || record.requestId) {
      return false
    }
    await this.cleanup(artifactId)
    return true
  }

  async cleanupMany(artifactIds: Iterable<string>): Promise<void> {
    await Promise.allSettled([...new Set(artifactIds)].map((id) => this.cleanup(id)))
  }

  async close(): Promise<void> {
    clearInterval(this.sweepTimer)
    await this.ready
    await this.cleanupMany(this.records.keys())
  }

  private async prepareRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const entries = await readdir(this.root, { withFileTypes: true })
    await Promise.allSettled(
      entries
        .filter((entry) => /^artifact-[0-9a-f-]{36}$/.test(entry.name))
        .map((entry) => rm(join(this.root, entry.name), { recursive: true, force: true }))
    )
  }

  private authorizedRecord(artifactId: string, conversationId: string): ArtifactRecord {
    const record = this.records.get(artifactId)
    if (!record || record.conversationId !== conversationId || record.expiresAt <= Date.now()) {
      throw new Error('artifact is unavailable for this conversation')
    }
    return record
  }

  private publicMetadata(record: ArtifactRecord): TeamChatArtifactAttachment {
    const { artifactId, name, artifactKind, mimeType, sizeBytes, sha256 } = record
    return { kind: 'artifact', artifactId, name, artifactKind, mimeType, sizeBytes, sha256 }
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now()
    await this.cleanupMany(
      [...this.records.values()]
        .filter((record) => record.expiresAt <= now)
        .map((record) => record.artifactId)
    )
  }
}
