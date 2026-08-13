import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  createPackagedRuntimeNodeModuleResources,
  prunePackagedNapiCanvas
} = require('../packaged-runtime-node-modules.cjs')

describe('Hermes local document packaging', () => {
  it('includes and prunes the PDF canvas native runtime', async () => {
    const packagedTargets = createPackagedRuntimeNodeModuleResources().map(
      (resource) => resource.to
    )
    expect(packagedTargets).toContain(join('node_modules', '@napi-rs', 'canvas'))
    expect(
      packagedTargets.some((target) =>
        target.startsWith(join('node_modules', '@napi-rs', 'canvas-'))
      )
    ).toBe(true)

    const resourcesDir = await mkdtemp(join(tmpdir(), 'orca-pdf-canvas-prune-'))
    try {
      const napiDir = join(resourcesDir, 'node_modules', '@napi-rs')
      await mkdir(join(napiDir, 'canvas'), { recursive: true })
      await mkdir(join(napiDir, 'canvas-darwin-arm64'), { recursive: true })
      await mkdir(join(napiDir, 'canvas-linux-x64-gnu'), { recursive: true })
      await mkdir(join(napiDir, 'canvas-win32-x64-msvc'), { recursive: true })
      prunePackagedNapiCanvas(resourcesDir, 'win32', 'x64')
      await expect(readdir(napiDir).then((entries) => entries.sort())).resolves.toEqual([
        'canvas',
        'canvas-win32-x64-msvc'
      ])
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })
})
