import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronBuilderConfig from '../electron-builder.config.cjs'

describe('Excel Artifact packaging contract', () => {
  it('ships the frozen Windows worker as an ordinary resource directory', () => {
    expect(electronBuilderConfig.win.extraResources).toContainEqual({
      from: 'resources/hermes-excel-artifact-worker/win32-x64/orca-excel-artifact-worker',
      to: 'hermes-excel-artifact-worker'
    })
    expect(electronBuilderConfig.afterSign).toBeTypeOf('function')
  })

  it('refreshes the packaged manifest after executable signing', async () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'orca-after-sign-'))
    try {
      const workerRoot = join(appOutDir, 'resources', 'hermes-excel-artifact-worker')
      mkdirSync(workerRoot, { recursive: true })
      writeFileSync(join(workerRoot, 'orca-excel-artifact-worker.exe'), 'signed-worker')
      writeFileSync(join(workerRoot, 'manifest.json'), '{}')
      await electronBuilderConfig.afterSign({ electronPlatformName: 'win32', appOutDir })
      const manifest = JSON.parse(readFileSync(join(workerRoot, 'manifest.json'), 'utf8'))
      expect(manifest['orca-excel-artifact-worker.exe']).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      rmSync(appOutDir, { recursive: true, force: true })
    }
  })
})
