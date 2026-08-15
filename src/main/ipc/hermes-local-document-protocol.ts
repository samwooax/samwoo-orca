import { LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT } from './hermes-local-document-prompt'
import type {
  LocalDocumentOperation,
  LocalDocumentRequest,
  LocalDocumentResult,
  LocalDocumentTranslation,
  LocalOfficeDocumentEdit,
  LocalPresentationTranslation
} from './hermes-local-document-types'

export { LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT }
export type * from './hermes-local-document-types'

const REQUEST_OPEN = '<orca_local_documents>'
const REQUEST_CLOSE = '</orca_local_documents>'
const MAX_OPERATIONS = 4
const MAX_PATH_CHARS = 512
const MAX_EXTRACT_ITEMS = 200
const MAX_TRANSLATIONS = 128
const MAX_TEXT_CHARS = 32_767

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value)
}

function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_CHARS
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function parseTranslation(value: unknown): LocalDocumentTranslation | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['sheet', 'cell', 'sourceText', 'translatedText'])) {
    return null
  }
  if (
    typeof value.sheet !== 'string' ||
    value.sheet.length === 0 ||
    value.sheet.length > 128 ||
    typeof value.cell !== 'string' ||
    !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(value.cell) ||
    typeof value.sourceText !== 'string' ||
    value.sourceText.length > MAX_TEXT_CHARS ||
    typeof value.translatedText !== 'string' ||
    value.translatedText.length === 0 ||
    value.translatedText.length > MAX_TEXT_CHARS
  ) {
    return null
  }
  return {
    sheet: value.sheet,
    cell: value.cell,
    sourceText: value.sourceText,
    translatedText: value.translatedText
  }
}

function parsePresentationTranslation(value: unknown): LocalPresentationTranslation | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['slide', 'paragraph', 'sourceText', 'translatedText']) ||
    !Number.isInteger(value.slide) ||
    Number(value.slide) < 1 ||
    Number(value.slide) > 200 ||
    !Number.isInteger(value.paragraph) ||
    Number(value.paragraph) < 1 ||
    Number(value.paragraph) > 20_000 ||
    typeof value.sourceText !== 'string' ||
    value.sourceText.length > MAX_TEXT_CHARS ||
    typeof value.translatedText !== 'string' ||
    value.translatedText.length === 0 ||
    value.translatedText.length > MAX_TEXT_CHARS
  ) {
    return null
  }
  return {
    slide: Number(value.slide),
    paragraph: Number(value.paragraph),
    sourceText: value.sourceText,
    translatedText: value.translatedText
  }
}

function parseOfficeOperation(value: Record<string, unknown>): LocalDocumentOperation | null {
  if (value.kind === 'create_pptx' || value.kind === 'create_pdf') {
    if (
      !hasOnlyKeys(value, ['id', 'kind', 'outputPath', 'documentSpec']) ||
      !validPath(value.outputPath) ||
      !isRecord(value.documentSpec) ||
      JSON.stringify(value.documentSpec).length > 512_000
    ) {
      return null
    }
    return {
      id: value.id as string,
      kind: value.kind,
      outputPath: value.outputPath,
      documentSpec: value.documentSpec
    }
  }
  if (value.kind !== 'edit_pptx' && value.kind !== 'edit_pdf') {
    return null
  }
  if (
    !hasOnlyKeys(value, ['id', 'kind', 'path', 'outputPath', 'expectedSha256', 'edits']) ||
    !validPath(value.path) ||
    !validPath(value.outputPath) ||
    typeof value.expectedSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.expectedSha256) ||
    !Array.isArray(value.edits) ||
    value.edits.length === 0 ||
    value.edits.length > 256 ||
    value.edits.some((edit) => !isRecord(edit) || typeof edit.kind !== 'string') ||
    JSON.stringify(value.edits).length > 512_000
  ) {
    return null
  }
  return {
    id: value.id as string,
    kind: value.kind,
    path: value.path,
    outputPath: value.outputPath,
    expectedSha256: value.expectedSha256,
    edits: value.edits as LocalOfficeDocumentEdit[]
  }
}

function parseTranslationOperation(value: Record<string, unknown>): LocalDocumentOperation | null {
  if (
    !hasOnlyKeys(value, ['id', 'kind', 'path', 'outputPath', 'expectedSha256', 'translations']) ||
    !['apply_xlsx_translation', 'apply_pptx_translation'].includes(String(value.kind)) ||
    !validPath(value.path) ||
    !validPath(value.outputPath) ||
    typeof value.expectedSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.expectedSha256) ||
    !Array.isArray(value.translations) ||
    value.translations.length === 0 ||
    value.translations.length > MAX_TRANSLATIONS
  ) {
    return null
  }
  if (value.kind === 'apply_pptx_translation') {
    const translations = value.translations.map(parsePresentationTranslation)
    if (translations.some((item) => item === null)) {
      return null
    }
    const typed = translations as LocalPresentationTranslation[]
    if (
      new Set(typed.map(({ slide, paragraph }) => `${slide}\0${paragraph}`)).size !== typed.length
    ) {
      return null
    }
    return {
      id: value.id as string,
      kind: value.kind,
      path: value.path,
      outputPath: value.outputPath,
      expectedSha256: value.expectedSha256,
      translations: typed
    }
  }
  const translations = value.translations.map(parseTranslation)
  if (translations.some((item) => item === null)) {
    return null
  }
  const typed = translations as LocalDocumentTranslation[]
  if (new Set(typed.map(({ sheet, cell }) => `${sheet}\0${cell}`)).size !== typed.length) {
    return null
  }
  return {
    id: value.id as string,
    kind: 'apply_xlsx_translation',
    path: value.path,
    outputPath: value.outputPath,
    expectedSha256: value.expectedSha256,
    translations: typed
  }
}

function parseOperation(value: unknown): LocalDocumentOperation | null {
  if (!isRecord(value) || !validId(value.id)) {
    return null
  }
  const office = parseOfficeOperation(value)
  if (
    office ||
    String(value.kind).startsWith('create_') ||
    String(value.kind).startsWith('edit_')
  ) {
    return office
  }
  if (value.kind === 'inspect' && validPath(value.path)) {
    return hasOnlyKeys(value, ['id', 'kind', 'path'])
      ? { id: value.id, kind: value.kind, path: value.path }
      : null
  }
  if (value.kind === 'extract' && validPath(value.path)) {
    if (
      !hasOnlyKeys(value, ['id', 'kind', 'path', 'cursor', 'limit']) ||
      (value.cursor !== undefined &&
        (!Number.isInteger(value.cursor) || Number(value.cursor) < 0)) ||
      (value.limit !== undefined &&
        (!Number.isInteger(value.limit) || Number(value.limit) < 1))
    ) {
      return null
    }
    return {
      id: value.id,
      kind: value.kind,
      path: value.path,
      ...(value.cursor === undefined ? {} : { cursor: Number(value.cursor) }),
      ...(value.limit === undefined
        ? {}
        : { limit: Math.min(Number(value.limit), MAX_EXTRACT_ITEMS) })
    }
  }
  return parseTranslationOperation(value)
}

export function parseLocalDocumentRequest(reply: string): LocalDocumentRequest | null {
  const trimmed = reply.trim()
  if (!trimmed.startsWith(REQUEST_OPEN) || !trimmed.endsWith(REQUEST_CLOSE)) {
    return null
  }
  try {
    const value = JSON.parse(trimmed.slice(REQUEST_OPEN.length, -REQUEST_CLOSE.length)) as unknown
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ['version', 'operations']) ||
      value.version !== 1 ||
      !Array.isArray(value.operations) ||
      value.operations.length === 0 ||
      value.operations.length > MAX_OPERATIONS
    ) {
      return null
    }
    const operations = value.operations.map(parseOperation)
    if (operations.some((operation) => operation === null)) {
      return null
    }
    const typed = operations as LocalDocumentOperation[]
    if (new Set(typed.map((operation) => operation.id)).size !== typed.length) {
      return null
    }
    return { version: 1, operations: typed }
  } catch {
    return null
  }
}

export function formatLocalDocumentResults(results: LocalDocumentResult[]): string {
  return `<orca_local_document_results>${JSON.stringify({ version: 1, results })}</orca_local_document_results>`
}
