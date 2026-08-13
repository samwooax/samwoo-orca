import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import manifestWriter from './hermes-excel-artifact-worker-manifest.cjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Excel Artifact worker manifest', () => {
  it('refreshes hashes after packaging mutates a signed executable', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-worker-manifest-'))
    roots.push(root)
    mkdirSync(join(root, '_internal'))
    writeFileSync(join(root, '_internal', 'engine.dll'), 'engine')
    const executable = join(root, 'orca-excel-artifact-worker.exe')
    writeFileSync(executable, 'unsigned')
    manifestWriter.writeExcelArtifactWorkerManifest(root)
    writeFileSync(executable, 'signed')
    const manifest = manifestWriter.writeExcelArtifactWorkerManifest(root)
    expect(manifest['orca-excel-artifact-worker.exe']).toBe(
      createHash('sha256').update('signed').digest('hex')
    )
    expect(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))).toEqual(manifest)
  })
})
