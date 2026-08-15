import { describe, expect, it, vi } from 'vitest'

vi.mock('./hermes-local-document-pdf', () => {
  throw new Error('PDF runtime unavailable')
})

vi.mock('./hermes-local-document-xlsx', () => ({
  applyXlsxTranslations: vi.fn(),
  extractXlsxCells: vi.fn(),
  inspectXlsx: vi.fn(() => [
    {
      name: 'Dashboard',
      cellCount: 2,
      textCellCount: 2,
      numericCellCount: 0,
      formulaCellCount: 0
    }
  ]),
  parseXlsx: vi.fn(() => ({}))
}))

describe('Hermes local document worker operation isolation', () => {
  it('does not load the PDF runtime for XLSX inspection', async () => {
    const { executeLocalDocumentWorkerOperation } =
      await import('./hermes-local-document-worker-operations')
    await expect(
      executeLocalDocumentWorkerOperation({
        format: 'xlsx',
        kind: 'inspect',
        data: new Uint8Array([0x50, 0x4b])
      })
    ).resolves.toEqual({
      format: 'xlsx',
      sheets: [
        {
          name: 'Dashboard',
          cellCount: 2,
          textCellCount: 2,
          numericCellCount: 0,
          formulaCellCount: 0
        }
      ]
    })
  })
})
