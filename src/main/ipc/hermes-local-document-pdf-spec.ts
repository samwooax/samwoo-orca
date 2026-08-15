const MAX_PDF_PAGES = 1_000
const MAX_PAGE_ELEMENTS = 128
const MAX_TEXT_CHARS = 32_767

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function optionalNumber(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || (typeof value === 'number' && value >= minimum && value <= maximum)
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_CHARS
}

function validPdfTextElement(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'type',
      'x',
      'y',
      'width',
      'height',
      'fontSize',
      'lineHeight',
      'bold',
      'color',
      'align',
      'text'
    ]) ||
    value.type !== 'text' ||
    !validText(value.text) ||
    !optionalNumber(value.x, 0, 100) ||
    !optionalNumber(value.y, 0, 100) ||
    !optionalNumber(value.width, 0.01, 100) ||
    !optionalNumber(value.height, 0.01, 100) ||
    !optionalNumber(value.fontSize, 6, 72) ||
    !optionalNumber(value.lineHeight, 6, 144) ||
    !optionalBoolean(value.bold)
  ) {
    return false
  }
  if (value.color !== undefined && !/^#?[a-fA-F0-9]{6}$/.test(String(value.color))) {
    return false
  }
  return value.align === undefined || ['left', 'center', 'right'].includes(String(value.align))
}

function validPdfPage(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['title', 'text', 'fontSize', 'lineHeight', 'elements']) ||
    !optionalNumber(value.fontSize, 6, 72) ||
    !optionalNumber(value.lineHeight, 6, 144)
  ) {
    return false
  }
  if (
    (value.title !== undefined && !validText(value.title)) ||
    (value.text !== undefined && !validText(value.text))
  ) {
    return false
  }
  const legacyText = validText(value.title) || validText(value.text)
  if (value.elements === undefined) {
    return legacyText
  }
  return (
    Array.isArray(value.elements) &&
    value.elements.length > 0 &&
    value.elements.length <= MAX_PAGE_ELEMENTS &&
    value.elements.every(validPdfTextElement)
  )
}

export function validPdfDocumentSpec(value: Record<string, unknown>): boolean {
  return (
    hasOnlyKeys(value, ['pageSize', 'pages']) &&
    (value.pageSize === undefined || ['A4', 'a4', 'letter'].includes(String(value.pageSize))) &&
    Array.isArray(value.pages) &&
    value.pages.length > 0 &&
    value.pages.length <= MAX_PDF_PAGES &&
    value.pages.every(validPdfPage)
  )
}
