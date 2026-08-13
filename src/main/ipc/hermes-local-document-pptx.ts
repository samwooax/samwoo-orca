import { posix } from 'node:path'
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom'
import { strToU8, unzipSync, zipSync, type Unzipped } from 'fflate'
import type {
  LocalDocumentItem,
  LocalPresentationTranslation
} from './hermes-local-document-protocol'

const MAX_ARCHIVE_ENTRIES = 4_096
const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_XML_BYTES = 16 * 1024 * 1024
const MAX_SLIDES = 200
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

type PptxParagraph = {
  element: Element
  textElements: Element[]
  text: string
}

type PptxSlide = {
  index: number
  path: string
  document: Document
  paragraphs: PptxParagraph[]
  tableCount: number
  chartCount: number
  imageCount: number
}

export type ParsedPptx = {
  archive: Unzipped
  slides: PptxSlide[]
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

function unzipPresentation(content: Uint8Array): Unzipped {
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
        normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.startsWith('/')
      ) {
        throw new Error('PPTX archive exceeds safe extraction limits')
      }
      return true
    }
  })
  const actualBytes = Object.values(archive).reduce((total, entry) => total + entry.byteLength, 0)
  if (actualBytes > MAX_ARCHIVE_TOTAL_BYTES) {
    throw new Error('PPTX archive exceeds safe extraction limits')
  }
  return archive
}

function resolvePresentationTarget(target: string): string {
  const packageRelative = target.replaceAll('\\', '/').replace(/^\/+/, '')
  const normalized = posix.normalize(
    target.startsWith('/') ? packageRelative : posix.join('ppt', packageRelative)
  )
  if (!normalized.startsWith('ppt/slides/') || normalized.includes('/../')) {
    throw new Error('PPTX slide relationship escapes the presentation')
  }
  return normalized
}

function validatePackage(archive: Unzipped): void {
  const contentTypes = decodeXml(archive['[Content_Types].xml'], 'content types')
  if (!contentTypes.includes('presentationml.presentation.main+xml')) {
    throw new Error('file content is not a PPTX presentation')
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
      throw new Error('external PPTX relationships are not supported')
    }
  }
}

function slidePaths(archive: Unzipped): string[] {
  const presentation = parseXml(archive['ppt/presentation.xml'], 'presentation')
  const relationships = parseXml(
    archive['ppt/_rels/presentation.xml.rels'],
    'presentation relationships'
  )
  const targets = new Map(
    elements(relationships, 'Relationship').map((relationship) => [
      relationship.getAttribute('Id'),
      relationship.getAttribute('Target')
    ])
  )
  const paths = elements(presentation, 'sldId').map((slide) => {
    const relationshipId = slide.getAttribute('r:id') || slide.getAttribute('id')
    const target = targets.get(relationshipId)
    if (!target) {
      throw new Error('PPTX slide relationship is missing')
    }
    return resolvePresentationTarget(target)
  })
  if (paths.length > MAX_SLIDES) {
    throw new Error(`PPTX exceeds the ${MAX_SLIDES}-slide limit`)
  }
  return paths
}

function slideParagraphs(document: Document): PptxParagraph[] {
  return elements(document, 'p').flatMap((element) => {
    const textElements = elements(element, 't')
    const text = textElements.map((node) => node.textContent ?? '').join('')
    return text.length > 0 ? [{ element, textElements, text }] : []
  })
}

export function parsePptx(content: Uint8Array): ParsedPptx {
  const archive = unzipPresentation(content)
  validatePackage(archive)
  const slides = slidePaths(archive).map((path, offset) => {
    const document = parseXml(archive[path], `slide ${offset + 1}`)
    if (elements(document, 'oleObj').length > 0) {
      throw new Error('embedded PPTX objects are not supported')
    }
    return {
      index: offset + 1,
      path,
      document,
      paragraphs: slideParagraphs(document),
      tableCount: elements(document, 'tbl').length,
      chartCount: elements(document, 'chart').length,
      imageCount: elements(document, 'blip').length
    }
  })
  return { archive, slides }
}

export function inspectPptx(parsed: ParsedPptx): {
  slideCount: number
  slides: {
    index: number
    textParagraphCount: number
    tableCount: number
    chartCount: number
    imageCount: number
  }[]
} {
  return {
    slideCount: parsed.slides.length,
    slides: parsed.slides.map((slide) => ({
      index: slide.index,
      textParagraphCount: slide.paragraphs.length,
      tableCount: slide.tableCount,
      chartCount: slide.chartCount,
      imageCount: slide.imageCount
    }))
  }
}

export function extractPptxParagraphs(
  parsed: ParsedPptx,
  cursor: number,
  limit: number
): { items: LocalDocumentItem[]; nextCursor?: number } {
  const paragraphs = parsed.slides.flatMap((slide) =>
    slide.paragraphs.map((paragraph, offset) => ({
      kind: 'pptx_paragraph' as const,
      slide: slide.index,
      paragraph: offset + 1,
      text: paragraph.text
    }))
  )
  const items = paragraphs.slice(cursor, cursor + limit)
  return {
    items,
    ...(cursor + items.length < paragraphs.length ? { nextCursor: cursor + items.length } : {})
  }
}

function replaceParagraphText(paragraph: PptxParagraph, translatedText: string): void {
  const first = paragraph.textElements[0]
  const document = first?.ownerDocument
  if (!first || !document) {
    throw new Error('PPTX paragraph has no editable text run')
  }
  for (const element of paragraph.textElements) {
    while (element.firstChild) {
      element.removeChild(element.firstChild)
    }
    element.removeAttributeNS(XML_NAMESPACE, 'space')
  }
  if (translatedText !== translatedText.trim()) {
    first.setAttributeNS(XML_NAMESPACE, 'xml:space', 'preserve')
  }
  first.appendChild(document.createTextNode(translatedText))
  paragraph.text = translatedText
}

export function applyPptxTranslations(
  parsed: ParsedPptx,
  translations: LocalPresentationTranslation[]
): Uint8Array {
  const changedSlides = new Set<PptxSlide>()
  for (const translation of translations) {
    const slide = parsed.slides[translation.slide - 1]
    const paragraph = slide?.paragraphs[translation.paragraph - 1]
    if (!slide || !paragraph) {
      throw new Error(
        `PPTX text paragraph was not found: slide ${translation.slide}, paragraph ${translation.paragraph}`
      )
    }
    if (paragraph.text !== translation.sourceText) {
      throw new Error(
        `PPTX source text changed: slide ${translation.slide}, paragraph ${translation.paragraph}`
      )
    }
    replaceParagraphText(paragraph, translation.translatedText)
    changedSlides.add(slide)
  }
  const serializer = new XMLSerializer()
  for (const slide of changedSlides) {
    parsed.archive[slide.path] = strToU8(serializer.serializeToString(slide.document))
  }
  const output = zipSync(parsed.archive, { level: 6 })
  const verified = parsePptx(output)
  for (const translation of translations) {
    const text = verified.slides[translation.slide - 1]?.paragraphs[translation.paragraph - 1]?.text
    if (text !== translation.translatedText) {
      throw new Error(
        `PPTX translation verification failed: slide ${translation.slide}, paragraph ${translation.paragraph}`
      )
    }
  }
  return output
}
