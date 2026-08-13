import { posix } from 'node:path'
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom'
import { strToU8, unzipSync, zipSync, type Unzipped } from 'fflate'
import type { LocalDocumentItem, LocalDocumentTranslation } from './hermes-local-document-protocol'

const MAX_ARCHIVE_ENTRIES = 4_096
const MAX_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_ARCHIVE_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_XML_BYTES = 16 * 1024 * 1024
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

type XlsxSheet = {
  name: string
  path: string
  document: Document
  cells: Map<string, { element: Element; text: string }>
}

export type ParsedXlsx = {
  archive: Unzipped
  sheets: XlsxSheet[]
}

function decodeXml(content: Uint8Array | undefined, label: string): string {
  if (!content || content.byteLength > MAX_XML_BYTES) {
    throw new Error(`${label} is missing or too large`)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    throw new Error(`${label} is not valid UTF-8 XML`)
  }
}

function parseXml(content: Uint8Array | undefined, label: string): Document {
  const source = decodeXml(content, label)
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error(`${label} contains a forbidden XML declaration`)
  }
  const parser = new DOMParser({
    locator: false,
    onError: (level, message) => {
      if (level !== 'warning') {
        throw new Error(`${label}: ${message}`)
      }
    }
  })
  return parser.parseFromString(source, 'application/xml')
}

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

function descendantText(parent: Element): string {
  return elements(parent, 't')
    .map((node) => node.textContent ?? '')
    .join('')
}

function unzipWorkbook(content: Uint8Array): Unzipped {
  let entries = 0
  let advertisedBytes = 0
  const archive = unzipSync(content, {
    filter: (entry) => {
      entries += 1
      advertisedBytes += entry.originalSize
      const normalized = posix.normalize(entry.name.replaceAll('\\', '/'))
      if (
        entries > MAX_ARCHIVE_ENTRIES ||
        entry.originalSize > MAX_ARCHIVE_ENTRY_BYTES ||
        advertisedBytes > MAX_ARCHIVE_TOTAL_BYTES ||
        normalized.startsWith('../') ||
        normalized.startsWith('/')
      ) {
        throw new Error('XLSX archive exceeds safe extraction limits')
      }
      return true
    }
  })
  const actualBytes = Object.values(archive).reduce((total, entry) => total + entry.byteLength, 0)
  if (actualBytes > MAX_ARCHIVE_TOTAL_BYTES) {
    throw new Error('XLSX archive exceeds safe extraction limits')
  }
  return archive
}

function validatePackage(archive: Unzipped): void {
  const contentTypes = decodeXml(archive['[Content_Types].xml'], 'content types')
  if (!contentTypes.includes('spreadsheetml.sheet.main+xml')) {
    throw new Error('file content is not an XLSX workbook')
  }
  if (/macroEnabled|vbaProject|activeX|oleObject/i.test(contentTypes)) {
    throw new Error('macro, ActiveX, and embedded OLE content is not supported')
  }
  for (const [path, content] of Object.entries(archive)) {
    if (!path.endsWith('.rels')) {
      continue
    }
    const relationships = parseXml(content, `relationships ${path}`)
    if (
      elements(relationships, 'Relationship').some(
        (relationship) => relationship.getAttribute('TargetMode') === 'External'
      )
    ) {
      throw new Error('external XLSX relationships are not supported')
    }
  }
}

function resolveWorkbookTarget(target: string): string {
  const packageRelative = target.replaceAll('\\', '/').replace(/^\/+/, '')
  const normalized = posix.normalize(
    target.startsWith('/') ? packageRelative : posix.join('xl', packageRelative)
  )
  if (!normalized.startsWith('xl/') || normalized.includes('/../')) {
    throw new Error('XLSX worksheet relationship escapes the workbook')
  }
  return normalized
}

function sharedStrings(archive: Unzipped): string[] {
  const content = archive['xl/sharedStrings.xml']
  if (!content) {
    return []
  }
  return elements(parseXml(content, 'shared strings'), 'si').map(descendantText)
}

function cellText(cell: Element, strings: string[]): string | null {
  if (firstElement(cell, 'f')) {
    return null
  }
  const type = cell.getAttribute('t')
  if (type === 'inlineStr') {
    return descendantText(cell)
  }
  const value = firstElement(cell, 'v')?.textContent ?? ''
  if (type === 's') {
    const index = Number(value)
    return Number.isInteger(index) && index >= 0 ? (strings[index] ?? null) : null
  }
  return type === 'str' ? value : null
}

function worksheetPaths(archive: Unzipped): { name: string; path: string }[] {
  const workbook = parseXml(archive['xl/workbook.xml'], 'workbook')
  const relationships = parseXml(archive['xl/_rels/workbook.xml.rels'], 'workbook relationships')
  const targets = new Map(
    elements(relationships, 'Relationship').map((relationship) => [
      relationship.getAttribute('Id'),
      relationship.getAttribute('Target')
    ])
  )
  return elements(workbook, 'sheet').map((sheet) => {
    const name = sheet.getAttribute('name')
    const relationshipId = sheet.getAttribute('r:id') || sheet.getAttribute('id')
    const target = targets.get(relationshipId)
    if (!name || !target) {
      throw new Error(`XLSX sheet relationship is missing: ${name ?? '(unnamed)'}`)
    }
    return { name, path: resolveWorkbookTarget(target) }
  })
}

export function parseXlsx(content: Uint8Array): ParsedXlsx {
  const archive = unzipWorkbook(content)
  validatePackage(archive)
  const strings = sharedStrings(archive)
  const sheets = worksheetPaths(archive).map(({ name, path }) => {
    const document = parseXml(archive[path], `worksheet ${name}`)
    const cells = new Map<string, { element: Element; text: string }>()
    for (const element of elements(document, 'c')) {
      const address = element.getAttribute('r')
      const text = cellText(element, strings)
      if (address && text !== null && text.length > 0) {
        cells.set(address, { element, text })
      }
    }
    return { name, path, document, cells }
  })
  return { archive, sheets }
}

export function inspectXlsx(parsed: ParsedXlsx): { name: string; textCellCount: number }[] {
  return parsed.sheets.map((sheet) => ({ name: sheet.name, textCellCount: sheet.cells.size }))
}

export function extractXlsxCells(
  parsed: ParsedXlsx,
  cursor: number,
  limit: number
): { items: LocalDocumentItem[]; nextCursor?: number } {
  const cells = parsed.sheets.flatMap((sheet) =>
    [...sheet.cells].map(([cell, value]) => ({
      kind: 'xlsx_cell' as const,
      sheet: sheet.name,
      cell,
      text: value.text
    }))
  )
  const items = cells.slice(cursor, cursor + limit)
  return {
    items,
    ...(cursor + items.length < cells.length ? { nextCursor: cursor + items.length } : {})
  }
}

function replaceCellText(cell: Element, translatedText: string): void {
  const document = cell.ownerDocument
  if (!document) {
    throw new Error('XLSX cell is detached from its worksheet')
  }
  while (cell.firstChild) {
    cell.removeChild(cell.firstChild)
  }
  cell.setAttribute('t', 'inlineStr')
  const namespace = cell.namespaceURI
  const inline = document.createElementNS(namespace, 'is')
  const text = document.createElementNS(namespace, 't')
  if (translatedText !== translatedText.trim()) {
    text.setAttributeNS(XML_NAMESPACE, 'xml:space', 'preserve')
  }
  text.appendChild(document.createTextNode(translatedText))
  inline.appendChild(text)
  cell.appendChild(inline)
}

export function applyXlsxTranslations(
  parsed: ParsedXlsx,
  translations: LocalDocumentTranslation[]
): Uint8Array {
  const sheetMap = new Map(parsed.sheets.map((sheet) => [sheet.name, sheet]))
  const changedSheets = new Set<XlsxSheet>()
  for (const translation of translations) {
    const sheet = sheetMap.get(translation.sheet)
    const cell = sheet?.cells.get(translation.cell)
    if (!sheet || !cell) {
      throw new Error(`XLSX text cell was not found: ${translation.sheet}!${translation.cell}`)
    }
    if (cell.text !== translation.sourceText) {
      throw new Error(`XLSX source text changed: ${translation.sheet}!${translation.cell}`)
    }
    replaceCellText(cell.element, translation.translatedText)
    cell.text = translation.translatedText
    changedSheets.add(sheet)
  }
  const serializer = new XMLSerializer()
  for (const sheet of changedSheets) {
    parsed.archive[sheet.path] = strToU8(serializer.serializeToString(sheet.document))
  }
  const output = zipSync(parsed.archive, { level: 6 })
  const verified = parseXlsx(output)
  for (const translation of translations) {
    const text = verified.sheets
      .find((sheet) => sheet.name === translation.sheet)
      ?.cells.get(translation.cell)?.text
    if (text !== translation.translatedText) {
      throw new Error(
        `XLSX translation verification failed: ${translation.sheet}!${translation.cell}`
      )
    }
  }
  return output
}
