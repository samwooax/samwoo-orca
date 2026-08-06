import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export type SamwooWorkspaceManifestEntry = { etag: string; hash: string }
export type SamwooWorkspaceManifest = {
  version: 1
  shareId: string
  files: Record<string, SamwooWorkspaceManifestEntry>
}

export function samwooWorkspaceFileHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function manifestPath(rootPath: string, shareId: string): string {
  const rootKey = createHash('sha256').update(path.resolve(rootPath)).digest('hex').slice(0, 24)
  return path.join(app.getPath('userData'), 'samwoo-workspace-sync', `${shareId}-${rootKey}.json`)
}

export async function readSamwooWorkspaceManifest(
  rootPath: string,
  shareId: string
): Promise<SamwooWorkspaceManifest> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(manifestPath(rootPath, shareId), 'utf8')
    ) as SamwooWorkspaceManifest
    if (parsed.version === 1 && parsed.shareId === shareId && parsed.files) {
      return parsed
    }
  } catch {
    // Why: a missing or damaged manifest must not grant overwrite authority over local files.
  }
  return { version: 1, shareId, files: {} }
}

export async function writeSamwooWorkspaceManifest(
  rootPath: string,
  manifest: SamwooWorkspaceManifest
): Promise<void> {
  const targetPath = manifestPath(rootPath, manifest.shareId)
  await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 })
  await fs.writeFile(targetPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
}
