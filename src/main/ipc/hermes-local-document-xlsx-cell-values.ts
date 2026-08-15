import type { Document, Element } from '@xmldom/xmldom'

export type XlsxCellValue = {
  text: string
  valueType: 'text' | 'number' | 'boolean' | 'date' | 'error' | 'formula'
  rawValue?: string
  formula?: string
  numberFormat?: string
  translatable: boolean
}

const BUILT_IN_NUMBER_FORMATS = new Map<number, string>([
  [0, 'General'],
  [1, '0'],
  [2, '0.00'],
  [9, '0%'],
  [10, '0.00%'],
  [14, 'm/d/yy'],
  [22, 'm/d/yy h:mm']
])

function elements(parent: Document | Element, localName: string): Element[] {
  const matches: Element[] = []
  const nodes = parent.getElementsByTagName('*')
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index)
    if (node?.localName === localName) {
      matches.push(node)
    }
  }
  return matches
}

function firstElement(parent: Document | Element, localName: string): Element | null {
  return elements(parent, localName)[0] ?? null
}

function childElements(parent: Element, localName: string): Element[] {
  const matches: Element[] = []
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index)
    if (node?.nodeType === 1 && (node as Element).localName === localName) {
      matches.push(node as Element)
    }
  }
  return matches
}

function descendantText(parent: Element): string {
  return elements(parent, 't')
    .map((node) => node.textContent ?? '')
    .join('')
}

export function workbookUses1904Dates(workbook: Document): boolean {
  return firstElement(workbook, 'workbookPr')?.getAttribute('date1904') === '1'
}

export function styleNumberFormats(styles: Document | null): (string | undefined)[] {
  if (!styles) {
    return []
  }
  const customFormats = new Map<number, string>()
  for (const format of elements(styles, 'numFmt')) {
    const id = Number(format.getAttribute('numFmtId'))
    const code = format.getAttribute('formatCode')
    if (Number.isInteger(id) && code) {
      customFormats.set(id, code)
    }
  }
  const cellFormats = firstElement(styles, 'cellXfs')
  return cellFormats
    ? childElements(cellFormats, 'xf').map((format) => {
        const id = Number(format.getAttribute('numFmtId'))
        return customFormats.get(id) ?? BUILT_IN_NUMBER_FORMATS.get(id)
      })
    : []
}

function isDateFormat(numberFormat: string | undefined): boolean {
  if (!numberFormat) {
    return false
  }
  const structural = numberFormat
    .replaceAll(/"[^"]*"/g, '')
    .replaceAll(/\\./g, '')
    .replaceAll(/\[[^\]]*]/g, '')
    .replaceAll(/general/gi, '')
    .replaceAll(/am\/pm/gi, '')
  return /(^|[^a-z])[ymdhis]+([^a-z]|$)/i.test(structural)
}

function excelDateText(rawValue: string, date1904: boolean): string | null {
  const serial = Number(rawValue)
  if (!Number.isFinite(serial) || (!date1904 && serial === 60)) {
    return null
  }
  const wholeDays = Math.floor(serial)
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, wholeDays < 60 ? 31 : 30)
  const iso = new Date(epoch + serial * 86_400_000).toISOString()
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.replace('.000Z', 'Z')
}

function numericText(rawValue: string, numberFormat: string | undefined): string {
  const numeric = Number(rawValue)
  if (!Number.isFinite(numeric)) {
    return rawValue
  }
  if (numberFormat?.includes('%')) {
    const decimalMatch = numberFormat.match(/0\.(0+)%/)
    const decimals = decimalMatch?.[1].length ?? 0
    return `${(numeric * 100).toFixed(decimals)}%`
  }
  return rawValue
}

export function readXlsxCellValue(
  cell: Element,
  strings: string[],
  numberFormats: (string | undefined)[],
  date1904: boolean
): XlsxCellValue | null {
  const formula = firstElement(cell, 'f')?.textContent ?? undefined
  const type = cell.getAttribute('t')
  const styleIndex = Number(cell.getAttribute('s'))
  const numberFormat = Number.isInteger(styleIndex) ? numberFormats[styleIndex] : undefined
  if (type === 'inlineStr') {
    const text = descendantText(cell)
    return text
      ? {
          text,
          valueType: formula !== undefined ? 'formula' : 'text',
          formula,
          translatable: !formula
        }
      : null
  }
  const valueElement = firstElement(cell, 'v')
  const rawValue = valueElement?.textContent ?? ''
  if (formula !== undefined && (!valueElement || rawValue === '')) {
    return {
      text: formula ? `=${formula}` : '=SHARED_FORMULA',
      valueType: 'formula',
      formula: formula || undefined,
      ...(numberFormat ? { numberFormat } : {}),
      translatable: false
    }
  }
  if (type === 's') {
    const index = Number(rawValue)
    const text = Number.isInteger(index) && index >= 0 ? strings[index] : undefined
    return text
      ? {
          text,
          valueType: formula !== undefined ? 'formula' : 'text',
          rawValue,
          formula,
          translatable: formula === undefined
        }
      : null
  }
  if (type === 'b') {
    return {
      text: rawValue === '1' ? 'TRUE' : 'FALSE',
      valueType: formula !== undefined ? 'formula' : 'boolean',
      rawValue,
      formula,
      translatable: false
    }
  }
  if (type === 'e') {
    return {
      text: rawValue,
      valueType: formula !== undefined ? 'formula' : 'error',
      rawValue,
      formula,
      translatable: false
    }
  }
  if (type === 'str' || type === 'd') {
    return rawValue
      ? {
          text: rawValue,
          valueType: formula !== undefined ? 'formula' : type === 'd' ? 'date' : 'text',
          rawValue,
          formula,
          translatable: formula === undefined && type === 'str'
        }
      : null
  }
  if (!valueElement || !rawValue) {
    return null
  }
  const dateText = isDateFormat(numberFormat) ? excelDateText(rawValue, date1904) : null
  return {
    text: dateText ?? numericText(rawValue, numberFormat),
    valueType: formula !== undefined ? 'formula' : dateText ? 'date' : 'number',
    rawValue,
    formula,
    ...(numberFormat ? { numberFormat } : {}),
    translatable: false
  }
}
