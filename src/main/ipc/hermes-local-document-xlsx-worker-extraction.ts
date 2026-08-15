// Routes XLSX inspect/extract to the bundled frozen worker, which streams huge
// worksheets (openpyxl read-only) that the in-process DOM parser cannot hold.
import type {
  LocalDocumentItem,
  LocalDocumentSheetSummary
} from './hermes-local-document-protocol'
import {
  getExcelArtifactCapability,
  runOfficeDocumentWorker
} from './hermes-excel-artifact-worker-client'

const EXTRACTION_TIMEOUT_MS = 180_000
const MAX_SHEETS = 4_096
const MAX_NAME_CHARS = 256
const MAX_TEXT_CHARS = 32_767
const MAX_ERROR_CHARS = 500
const CELL_ADDRESS = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/
const VALUE_TYPES = new Set(['text', 'number', 'boolean', 'date', 'error', 'formula'])

export type WorkerXlsxExtraction = {
  format: 'xlsx'
  sheets: LocalDocumentSheetSummary[]
  items?: LocalDocumentItem[]
  nextCursor?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('XLSX extraction worker returned an invalid cell count')
  }
  return value
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') {
    throw new Error('XLSX extraction worker returned an invalid text value')
  }
  return value.slice(0, maximum)
}

function validatedSheets(value: unknown): LocalDocumentSheetSummary[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SHEETS) {
    throw new Error('XLSX extraction worker returned an invalid sheet summary')
  }
  return value.map((sheet) => {
    if (!isRecord(sheet)) {
      throw new Error('XLSX extraction worker returned an invalid sheet summary')
    }
    return {
      name: boundedText(sheet.name, MAX_NAME_CHARS),
      cellCount: boundedCount(sheet.cellCount),
      textCellCount: boundedCount(sheet.textCellCount),
      numericCellCount: boundedCount(sheet.numericCellCount),
      formulaCellCount: boundedCount(sheet.formulaCellCount)
    }
  })
}

function validatedItems(value: unknown, limit: number): LocalDocumentItem[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error('XLSX extraction worker returned an invalid item window')
  }
  return value.map((item) => {
    if (
      !isRecord(item) ||
      item.kind !== 'xlsx_cell' ||
      !CELL_ADDRESS.test(String(item.cell)) ||
      !VALUE_TYPES.has(String(item.valueType))
    ) {
      throw new Error('XLSX extraction worker returned an invalid cell item')
    }
    return {
      kind: 'xlsx_cell',
      sheet: boundedText(item.sheet, MAX_NAME_CHARS),
      cell: String(item.cell),
      text: boundedText(item.text, MAX_TEXT_CHARS),
      valueType: String(item.valueType) as 'text' | 'number' | 'boolean' | 'date' | 'error' | 'formula',
      ...(item.rawValue === undefined ? {} : { rawValue: boundedText(item.rawValue, MAX_TEXT_CHARS) }),
      ...(item.formula === undefined ? {} : { formula: boundedText(item.formula, MAX_TEXT_CHARS) }),
      ...(item.numberFormat === undefined
        ? {}
        : { numberFormat: boundedText(item.numberFormat, MAX_NAME_CHARS) })
    }
  })
}

export async function runWorkerXlsxExtraction(args: {
  kind: 'inspect' | 'extract'
  sourcePath: string
  sha256: string
  cursor: number
  limit: number
  requestId: string
}): Promise<WorkerXlsxExtraction | null> {
  if (!(await getExcelArtifactCapability())) {
    return null
  }
  const processed = await runOfficeDocumentWorker(
    args.requestId,
    {
      action: args.kind === 'inspect' ? 'inspect_xlsx' : 'extract_xlsx',
      sourcePath: args.sourcePath,
      expectedSha256: args.sha256,
      ...(args.kind === 'extract' ? { cursor: args.cursor, limit: args.limit } : {})
    },
    EXTRACTION_TIMEOUT_MS
  )
  if (processed.ok !== true) {
    const error = isRecord(processed.error) ? processed.error : {}
    throw new Error(
      `XLSX extraction failed: ${String(error.message ?? 'worker error').slice(0, MAX_ERROR_CHARS)}`
    )
  }
  if (args.kind === 'inspect') {
    return { format: 'xlsx', sheets: validatedSheets(processed.sheets) }
  }
  const nextCursor = processed.nextCursor
  if (nextCursor !== undefined && (!Number.isInteger(nextCursor) || Number(nextCursor) < 0)) {
    throw new Error('XLSX extraction worker returned an invalid cursor')
  }
  return {
    format: 'xlsx',
    sheets: validatedSheets(processed.sheets),
    items: validatedItems(processed.items, args.limit),
    ...(nextCursor === undefined ? {} : { nextCursor: Number(nextCursor) })
  }
}
