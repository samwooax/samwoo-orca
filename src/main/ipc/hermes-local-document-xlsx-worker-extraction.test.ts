import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runWorkerXlsxExtraction } from './hermes-local-document-xlsx-worker-extraction'

const { getExcelArtifactCapabilityMock, runOfficeDocumentWorkerMock } = vi.hoisted(() => ({
  getExcelArtifactCapabilityMock: vi.fn(),
  runOfficeDocumentWorkerMock: vi.fn()
}))

vi.mock('./hermes-excel-artifact-worker-client', () => ({
  getExcelArtifactCapability: getExcelArtifactCapabilityMock,
  runOfficeDocumentWorker: runOfficeDocumentWorkerMock
}))

const SHEETS = [
  { name: 'Sheet1', cellCount: 415_176, textCellCount: 227_946, numericCellCount: 187_230, formulaCellCount: 0 }
]

beforeEach(() => {
  getExcelArtifactCapabilityMock.mockReset().mockResolvedValue({ name: 'excelArtifact' })
  runOfficeDocumentWorkerMock.mockReset()
})

describe('runWorkerXlsxExtraction', () => {
  it('returns null without spawning the worker when the capability is unavailable', async () => {
    getExcelArtifactCapabilityMock.mockResolvedValue(null)
    await expect(
      runWorkerXlsxExtraction({
        kind: 'inspect',
        sourcePath: 'C:\\artifacts\\book.xlsx',
        sha256: 'a'.repeat(64),
        cursor: 0,
        limit: 200,
        requestId: 'request-1'
      })
    ).resolves.toBeNull()
    expect(runOfficeDocumentWorkerMock).not.toHaveBeenCalled()
  })

  it('routes an extract window with the source hash and validates the result', async () => {
    runOfficeDocumentWorkerMock.mockResolvedValue({
      ok: true,
      sheets: SHEETS,
      items: [
        { kind: 'xlsx_cell', sheet: 'Sheet1', cell: 'A1', text: '사업부문', valueType: 'text' },
        {
          kind: 'xlsx_cell',
          sheet: 'Sheet1',
          cell: 'B2',
          text: '1,200',
          valueType: 'number',
          rawValue: '1200',
          numberFormat: '#,##0'
        }
      ],
      nextCursor: 102
    })

    const result = await runWorkerXlsxExtraction({
      kind: 'extract',
      sourcePath: 'C:\\artifacts\\book.xlsx',
      sha256: 'b'.repeat(64),
      cursor: 100,
      limit: 2,
      requestId: 'request-2'
    })

    expect(runOfficeDocumentWorkerMock).toHaveBeenCalledWith(
      'request-2',
      {
        action: 'extract_xlsx',
        sourcePath: 'C:\\artifacts\\book.xlsx',
        expectedSha256: 'b'.repeat(64),
        cursor: 100,
        limit: 2
      },
      180_000
    )
    expect(result).toEqual({
      format: 'xlsx',
      sheets: SHEETS,
      items: [
        { kind: 'xlsx_cell', sheet: 'Sheet1', cell: 'A1', text: '사업부문', valueType: 'text' },
        {
          kind: 'xlsx_cell',
          sheet: 'Sheet1',
          cell: 'B2',
          text: '1,200',
          valueType: 'number',
          rawValue: '1200',
          numberFormat: '#,##0'
        }
      ],
      nextCursor: 102
    })
  })

  it('routes inspect without cursor fields and returns only sheet summaries', async () => {
    runOfficeDocumentWorkerMock.mockResolvedValue({ ok: true, sheets: SHEETS })
    await expect(
      runWorkerXlsxExtraction({
        kind: 'inspect',
        sourcePath: 'C:\\artifacts\\book.xlsx',
        sha256: 'c'.repeat(64),
        cursor: 0,
        limit: 200,
        requestId: 'request-3'
      })
    ).resolves.toEqual({ format: 'xlsx', sheets: SHEETS })
    expect(runOfficeDocumentWorkerMock).toHaveBeenCalledWith(
      'request-3',
      {
        action: 'inspect_xlsx',
        sourcePath: 'C:\\artifacts\\book.xlsx',
        expectedSha256: 'c'.repeat(64)
      },
      180_000
    )
  })

  it('surfaces the sanitized worker error message', async () => {
    runOfficeDocumentWorkerMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'input_hash_mismatch',
        message: 'The workbook input hash does not match the admitted attachment.',
        recovery: 'Attach the current workbook and retry.'
      }
    })
    await expect(
      runWorkerXlsxExtraction({
        kind: 'inspect',
        sourcePath: 'C:\\artifacts\\book.xlsx',
        sha256: 'd'.repeat(64),
        cursor: 0,
        limit: 200,
        requestId: 'request-4'
      })
    ).rejects.toThrow('XLSX extraction failed: The workbook input hash does not match')
  })

  it('fails closed on malformed worker items and summaries', async () => {
    runOfficeDocumentWorkerMock.mockResolvedValue({
      ok: true,
      sheets: SHEETS,
      items: [{ kind: 'xlsx_cell', sheet: 'Sheet1', cell: 'not-an-address', text: 'x', valueType: 'text' }]
    })
    await expect(
      runWorkerXlsxExtraction({
        kind: 'extract',
        sourcePath: 'C:\\artifacts\\book.xlsx',
        sha256: 'e'.repeat(64),
        cursor: 0,
        limit: 5,
        requestId: 'request-5'
      })
    ).rejects.toThrow('invalid cell item')

    runOfficeDocumentWorkerMock.mockResolvedValue({ ok: true, sheets: [{ name: 'S' }] })
    await expect(
      runWorkerXlsxExtraction({
        kind: 'inspect',
        sourcePath: 'C:\\artifacts\\book.xlsx',
        sha256: 'f'.repeat(64),
        cursor: 0,
        limit: 200,
        requestId: 'request-6'
      })
    ).rejects.toThrow('invalid cell count')
  })
})
