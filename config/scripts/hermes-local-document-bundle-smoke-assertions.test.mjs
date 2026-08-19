import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertOfficePreview,
  assertWorkerManifest
} from './hermes-local-document-bundle-smoke-assertions.mjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function workerFixture() {
  const root = mkdtempSync(join(tmpdir(), 'orca-office-smoke-manifest-'))
  roots.push(root)
  mkdirSync(join(root, 'nested'))
  const payload = Buffer.from('worker')
  const nestedManifest = Buffer.from('nested manifest')
  writeFileSync(join(root, 'nested', 'worker.bin'), payload)
  writeFileSync(join(root, 'nested', 'manifest.json'), nestedManifest)
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      'nested/worker.bin': createHash('sha256').update(payload).digest('hex'),
      'nested/manifest.json': createHash('sha256').update(nestedManifest).digest('hex')
    })
  )
  return root
}

function previewFixture(visible) {
  const canvas = createCanvas(32, 32)
  const context = canvas.getContext('2d')
  context.fillStyle = 'white'
  context.fillRect(0, 0, 32, 32)
  if (visible) {
    context.fillStyle = 'black'
    context.fillRect(4, 4, 10, 10)
  }
  return {
    ok: true,
    mediaType: 'image/png',
    width: 32,
    height: 32,
    imageBase64: canvas.toBuffer('image/png').toString('base64')
  }
}

describe('Hermes office bundle smoke assertions', () => {
  it('checks the recursive manifest file set and hashes', async () => {
    const root = workerFixture()
    await expect(assertWorkerManifest(root, 'before rendering')).resolves.toBeUndefined()

    writeFileSync(join(root, 'nested', 'unexpected.pyc'), 'runtime mutation')
    await expect(assertWorkerManifest(root, 'after rendering')).rejects.toThrow(
      'manifest file set changed after rendering'
    )
  })

  it('rejects a manifest hash mismatch', async () => {
    const root = workerFixture()
    writeFileSync(join(root, 'nested', 'worker.bin'), 'mutated')
    await expect(assertWorkerManifest(root, 'after rendering')).rejects.toThrow(
      'manifest integrity failed after rendering: nested/worker.bin'
    )
  })

  it('does not exempt nested manifest files from integrity checks', async () => {
    const root = workerFixture()
    writeFileSync(join(root, 'nested', 'manifest.json'), 'mutated')
    await expect(assertWorkerManifest(root, 'after rendering')).rejects.toThrow(
      'manifest integrity failed after rendering: nested/manifest.json'
    )
  })

  it('requires visible non-white preview pixels', async () => {
    await expect(assertOfficePreview(previewFixture(true), 'XLSX')).resolves.toBeUndefined()
    await expect(assertOfficePreview(previewFixture(false), 'XLSX')).rejects.toThrow(
      'contains no visible non-white content'
    )
  })
})
