import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeLocalDocumentRequest } from './hermes-local-project-documents'

const { resolveAuthorizedPathMock, runLocalDocumentWorkerMock } = vi.hoisted(() => ({
  resolveAuthorizedPathMock: vi.fn(async (path: string) => resolve(path)),
  runLocalDocumentWorkerMock: vi.fn()
}))

vi.mock('./filesystem-auth', () => ({ resolveAuthorizedPath: resolveAuthorizedPathMock }))
vi.mock('./hermes-local-document-worker-client', () => ({
  runLocalDocumentWorker: runLocalDocumentWorkerMock
}))

const temporaryDirectories: string[] = []

beforeEach(() => {
  resolveAuthorizedPathMock.mockClear()
  runLocalDocumentWorkerMock.mockReset()
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('executeLocalDocumentRequest', () => {
  it('extracts an explicitly attached PDF without requiring a project root', async () => {
    const content = Buffer.from('%PDF-1.4')
    runLocalDocumentWorkerMock.mockResolvedValue({
      format: 'pdf',
      pageCount: 1,
      items: [{ kind: 'pdf_page', page: 1, text: 'Hello' }]
    })

    const results = await executeLocalDocumentRequest({
      cwd: '',
      store: {} as never,
      artifactStore: { read: vi.fn().mockResolvedValue(content) } as never,
      conversationId: 'conversation',
      requestId: 'request',
      attachments: [{ path: '@attachments/1-report.pdf', artifactId: 'artifact-pdf' }],
      request: {
        version: 1,
        operations: [
          {
            id: 'pdf',
            kind: 'extract',
            path: '@attachments/1-report.pdf',
            cursor: 0,
            limit: 10
          }
        ]
      }
    })

    expect(results).toMatchObject([
      {
        id: 'pdf',
        ok: true,
        format: 'pdf',
        sha256: createHash('sha256').update(content).digest('hex'),
        pageCount: 1
      }
    ])
    expect(resolveAuthorizedPathMock).not.toHaveBeenCalled()
  })

  it('writes an attached XLSX translation to a new project file without overwriting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-document-'))
    temporaryDirectories.push(root)
    const source = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    const output = new Uint8Array([0x50, 0x4b, 0x05, 0x06])
    const sourceHash = createHash('sha256').update(source).digest('hex')
    runLocalDocumentWorkerMock.mockResolvedValue({
      format: 'xlsx',
      output,
      appliedCount: 1
    })
    const operation = {
      id: 'xlsx',
      kind: 'apply_xlsx_translation' as const,
      path: '@attachments/1-KPI.xlsx',
      outputPath: 'KPI_ko.xlsx',
      expectedSha256: sourceHash,
      translations: [
        { sheet: 'Dashboard', cell: 'A1', sourceText: 'Revenue', translatedText: '매출' }
      ]
    }

    const results = await executeLocalDocumentRequest({
      cwd: root,
      store: {} as never,
      artifactStore: { read: vi.fn().mockResolvedValue(source) } as never,
      conversationId: 'conversation',
      requestId: 'request-one',
      attachments: [{ path: operation.path, artifactId: 'artifact-xlsx' }],
      request: { version: 1, operations: [operation] }
    })
    expect(results).toMatchObject([{ id: 'xlsx', ok: true, appliedCount: 1 }])
    expect(await readFile(join(root, 'KPI_ko.xlsx'))).toEqual(Buffer.from(output))

    await writeFile(join(root, 'existing.xlsx'), 'keep')
    const refused = await executeLocalDocumentRequest({
      cwd: root,
      store: {} as never,
      artifactStore: { read: vi.fn().mockResolvedValue(source) } as never,
      conversationId: 'conversation',
      requestId: 'request-two',
      attachments: [{ path: operation.path, artifactId: 'artifact-xlsx-two' }],
      request: {
        version: 1,
        operations: [{ ...operation, id: 'existing', outputPath: 'existing.xlsx' }]
      }
    })
    expect(refused).toMatchObject([{ id: 'existing', ok: false }])
    expect(await readFile(join(root, 'existing.xlsx'), 'utf8')).toBe('keep')
  })
})
