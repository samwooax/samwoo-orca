import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import electronBuilderConfig from '../electron-builder.config.cjs'
import {
  ensurePinnedDownload,
  LIBREOFFICE_LICENSE_URL,
  LIBREOFFICE_MSI_BYTES,
  LIBREOFFICE_MSI_SHA256,
  LIBREOFFICE_MSI_URL,
  LIBREOFFICE_REQUIRED_FILES,
  LIBREOFFICE_SOURCE_BYTES,
  LIBREOFFICE_SOURCE_SHA256,
  LIBREOFFICE_SOURCE_URL,
  LIBREOFFICE_VERSION,
  verifyBundledLibreOffice,
  writeLibreOfficeNotice
} from './prepare-hermes-libreoffice.mjs'

describe('Excel Artifact packaging contract', () => {
  it('ships the frozen Windows worker as an ordinary resource directory', () => {
    expect(electronBuilderConfig.win.extraResources).toContainEqual({
      from: 'resources/hermes-excel-artifact-worker/win32-x64/orca-excel-artifact-worker',
      to: 'hermes-excel-artifact-worker'
    })
    expect(electronBuilderConfig.files).toContain('!resources/hermes-excel-artifact-worker{,/**/*}')
    expect(electronBuilderConfig.files).toContain(
      '!resources/hermes-excel-artifact-worker-src{,/**/*}'
    )
    expect(electronBuilderConfig.afterSign).toBeTypeOf('function')
  })

  it('pins the bundled LibreOffice binary and corresponding source', () => {
    expect(LIBREOFFICE_VERSION).toBe('26.2.5')
    expect(LIBREOFFICE_MSI_BYTES).toBe(372_948_992)
    expect(LIBREOFFICE_MSI_SHA256).toBe(
      'f15ba07bfcb0186986cf3171063506f5d207c11f8cc051ba0d135209e9e915f9'
    )
    expect(LIBREOFFICE_MSI_URL).toBe(
      'https://download.documentfoundation.org/libreoffice/stable/26.2.5/win/x86_64/LibreOffice_26.2.5_Win_x86-64.msi'
    )
    expect(LIBREOFFICE_SOURCE_BYTES).toBe(292_259_528)
    expect(LIBREOFFICE_SOURCE_SHA256).toBe(
      '8ec785ee1fd1a1d9b9d8eba1c8ff7556695ca8f02e1f7a26bef8cd540f669fea'
    )
    expect(LIBREOFFICE_SOURCE_URL).toBe(
      'https://download.documentfoundation.org/libreoffice/src/26.2.5/libreoffice-26.2.5.2.tar.xz'
    )
    expect(LIBREOFFICE_LICENSE_URL).toBe('https://www.libreoffice.org/about-us/licenses/')
    const buildScript = readFileSync(
      new URL('./build-hermes-excel-artifact-worker.mjs', import.meta.url),
      'utf8'
    )
    const prepareCall = 'await prepareBundledLibreOffice'
    expect(buildScript).toContain(prepareCall)
    expect(buildScript.indexOf(prepareCall)).toBeLessThan(
      buildScript.indexOf('writeExcelArtifactWorkerManifest(bundleRoot)')
    )
    expect(buildScript).toContain('unverifiedLibreOfficeFiles')

    const workflow = readFileSync(
      new URL('../../.github/workflows/build-samwoo-windows.yml', import.meta.url),
      'utf8'
    )
    expect(workflow).toContain('path: tmp/hermes-libreoffice-cache')
    expect(workflow).toContain(
      `key: hermes-libreoffice-win-x64-${LIBREOFFICE_VERSION}-${LIBREOFFICE_MSI_SHA256}`
    )
  })

  it('replaces a cache entry only after the pinned download verifies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-libreoffice-cache-'))
    const destination = join(root, 'LibreOffice.msi')
    const trusted = Buffer.from('trusted')
    const corrupt = Buffer.from('corrupt')
    const sha256 = createHash('sha256').update(trusted).digest('hex')
    const download = (body) =>
      new Response(body, { headers: { 'content-length': String(body.length) } })
    try {
      writeFileSync(destination, 'stale!!')
      await expect(
        ensurePinnedDownload({
          destination,
          url: 'https://example.invalid/LibreOffice.msi',
          bytes: trusted.length,
          sha256,
          fetchImpl: async () => download(corrupt)
        })
      ).rejects.toThrow('pinned size or SHA-256')
      expect(readFileSync(destination, 'utf8')).toBe('stale!!')

      await expect(
        ensurePinnedDownload({
          destination,
          url: 'https://example.invalid/LibreOffice.msi',
          bytes: trusted.length,
          sha256,
          fetchImpl: async () => download(trusted)
        })
      ).resolves.toBe('download')
      expect(readFileSync(destination)).toEqual(trusted)

      let fetched = false
      const result = await ensurePinnedDownload({
        destination,
        url: 'https://example.invalid/LibreOffice.msi',
        bytes: trusted.length,
        sha256,
        fetchImpl: async () => {
          fetched = true
          throw new Error('verified cache should avoid the network')
        }
      })
      expect(result).toBe('cache')
      expect(fetched).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires portable runtime dependencies and writes source provenance', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-libreoffice-bundle-'))
    try {
      for (const relativePath of LIBREOFFICE_REQUIRED_FILES) {
        const path = join(root, relativePath)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, 'fixture')
      }
      writeLibreOfficeNotice(root)
      expect(verifyBundledLibreOffice(root)).toBe(true)
      const notice = readFileSync(join(root, 'SAMWOO-ORCA-LIBREOFFICE-NOTICE.txt'), 'utf8')
      expect(notice).toContain(`Corresponding source: ${LIBREOFFICE_SOURCE_URL}`)
      expect(notice).toContain(`Source SHA-256: ${LIBREOFFICE_SOURCE_SHA256}`)

      rmSync(join(root, 'program', 'vcruntime140_1.dll'))
      expect(() => verifyBundledLibreOffice(root)).toThrow('program/vcruntime140_1.dll')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the Python encoder and TypeScript receiver on the same image byte limit', () => {
    const workerSource = readFileSync(
      new URL(
        '../../resources/hermes-excel-artifact-worker-src/orca_office_preview.py',
        import.meta.url
      ),
      'utf8'
    )
    const receiverSource = readFileSync(
      new URL('../../src/main/ipc/hermes-team-chat-acp-office-preview.ts', import.meta.url),
      'utf8'
    )
    expect(workerSource).toContain('MAX_RESULT_BYTES = 700 * 1024')
    expect(receiverSource).toContain('MAX_PREVIEW_IMAGE_BYTES = 700 * 1024')
  })

  it('refreshes the packaged manifest after executable signing', async () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'orca-after-sign-'))
    try {
      const workerRoot = join(appOutDir, 'resources', 'hermes-excel-artifact-worker')
      mkdirSync(workerRoot, { recursive: true })
      writeFileSync(join(workerRoot, 'orca-excel-artifact-worker.exe'), 'signed-worker')
      const soffice = join(workerRoot, 'libreoffice', 'program', 'soffice.exe')
      mkdirSync(dirname(soffice), { recursive: true })
      writeFileSync(soffice, 'bundled-soffice')
      writeFileSync(join(workerRoot, 'manifest.json'), '{}')
      await electronBuilderConfig.afterSign({ electronPlatformName: 'win32', appOutDir })
      const manifest = JSON.parse(readFileSync(join(workerRoot, 'manifest.json'), 'utf8'))
      expect(manifest['orca-excel-artifact-worker.exe']).toMatch(/^[a-f0-9]{64}$/)
      expect(manifest['libreoffice/program/soffice.exe']).toBe(
        createHash('sha256').update('bundled-soffice').digest('hex')
      )
    } finally {
      rmSync(appOutDir, { recursive: true, force: true })
    }
  })
})
