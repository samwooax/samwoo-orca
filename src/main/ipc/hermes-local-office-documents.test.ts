import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  runOfficeDocumentWorker: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showSaveDialog: mocks.showSaveDialog }
}))

vi.mock('./hermes-excel-artifact-worker-client', () => ({
  runOfficeDocumentWorker: mocks.runOfficeDocumentWorker
}))

import { executeOfficeDocumentOperation } from './hermes-local-office-documents'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

beforeEach(() => {
  vi.clearAllMocks()
})

async function runCreate(output: string) {
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: output })
  return executeOfficeDocumentOperation({
    cwd: '',
    operation: {
      id: 'pdf',
      kind: 'create_pdf',
      outputPath: 'translated.pdf',
      documentSpec: { pageSize: 'A4', pages: [{ text: 'Visible text' }] }
    },
    store: {} as Store,
    attachments: undefined,
    artifactStore: undefined,
    conversationId: 'conversation',
    requestId: 'request',
    allowNativeSave: true
  })
}

describe('Hermes local office documents', () => {
  it('commits verified PDF text through an ASCII-only staging name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-office-output-'))
    roots.push(root)
    const output = join(root, '한국어-번역.pdf')
    const content = Buffer.from('%PDF-1.4\nvisible')
    let staging = ''
    mocks.runOfficeDocumentWorker.mockImplementation(async (_requestId, request) => {
      staging = String(request.outputPath)
      await writeFile(staging, content)
      return {
        ok: true,
        sha256: createHash('sha256').update(content).digest('hex'),
        pageCount: 1,
        textCharacterCount: 7
      }
    })

    await expect(runCreate(output)).resolves.toMatchObject({
      ok: true,
      outputPath: '한국어-번역.pdf',
      pageCount: 1,
      textCharacterCount: 7
    })
    await expect(readFile(output)).resolves.toEqual(content)
    expect(basename(staging)).toMatch(/^\.orca-document-[a-f0-9-]+\.tmp\.pdf$/)
    await expect(readdir(root)).resolves.toEqual(['한국어-번역.pdf'])
  })

  it('removes staging output when the generated PDF has no verified text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-office-output-'))
    roots.push(root)
    const output = join(root, 'empty.pdf')
    const content = Buffer.from('%PDF-1.4\nempty')
    mocks.runOfficeDocumentWorker.mockImplementation(async (_requestId, request) => {
      await writeFile(String(request.outputPath), content)
      return {
        ok: true,
        sha256: createHash('sha256').update(content).digest('hex'),
        pageCount: 1,
        textCharacterCount: 0
      }
    })

    await expect(runCreate(output)).rejects.toThrow('without extractable text')
    await expect(readdir(root)).resolves.toEqual([])
  })
})
