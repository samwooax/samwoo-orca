import type { ExcelArtifactRequest } from '../../shared/hermes-excel-artifact'

type JsonRecord = Record<string, unknown>

const VALIDATION_KEYS = new Set([
  'openXml',
  'formulas',
  'charts',
  'renderPreview',
  'requiredSheets',
  'requiredCells'
])

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAliasedField(value: unknown, canonical: string, alias: string): unknown {
  if (!isRecord(value) || !(alias in value)) {
    return value
  }
  if (canonical in value && value[canonical] !== value[alias]) {
    return value
  }
  const normalized = { ...value, [canonical]: value[alias] }
  delete normalized[alias]
  return normalized
}

function normalizeSheet(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  const sheet = { ...value }
  if (Array.isArray(sheet.columns)) {
    sheet.columns = sheet.columns.map((column) => normalizeAliasedField(column, 'range', 'column'))
  }
  if (Array.isArray(sheet.rows)) {
    sheet.rows = sheet.rows.map((row) => normalizeAliasedField(row, 'index', 'row'))
  }
  if (typeof sheet.autofilter === 'string') {
    sheet.autofilter = { range: sheet.autofilter }
  }
  return sheet
}

function normalizeWorkbookSpec(action: string, value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  const spec = { ...value }
  if (action === 'create' && spec.preservationPolicy === 'new_workbook') {
    spec.preservationPolicy = 'fail_on_unsupported_loss'
  }
  if (Array.isArray(spec.sheets)) {
    spec.sheets = spec.sheets.map(normalizeSheet)
  }
  return spec
}

function normalizeValidation(action: string, value: unknown): unknown {
  if (!['create', 'modify', 'validate'].includes(action)) {
    return value
  }
  if (value === undefined) {
    return { openXml: true, formulas: true, charts: true, renderPreview: false }
  }
  if (!isRecord(value) || Object.keys(value).some((key) => !VALIDATION_KEYS.has(key))) {
    return value
  }
  return {
    openXml: typeof value.openXml === 'boolean' ? value.openXml : true,
    formulas: typeof value.formulas === 'boolean' ? value.formulas : true,
    charts: typeof value.charts === 'boolean' ? value.charts : true,
    renderPreview: typeof value.renderPreview === 'boolean' ? value.renderPreview : false
  }
}

export function normalizeExcelArtifactRequest(value: JsonRecord): ExcelArtifactRequest {
  const action = String(value.action)
  const normalized = { ...value }
  if (['create', 'modify'].includes(action) && isRecord(normalized.output)) {
    normalized.output =
      typeof normalized.output.overwrite === 'boolean'
        ? normalized.output
        : { ...normalized.output, overwrite: false }
  }
  normalized.validation = normalizeValidation(action, normalized.validation)
  normalized.workbookSpec = normalizeWorkbookSpec(action, normalized.workbookSpec)
  return normalized as ExcelArtifactRequest
}
