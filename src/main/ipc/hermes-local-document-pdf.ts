import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { LocalDocumentItem } from './hermes-local-document-protocol'

const MAX_PDF_PAGES = 1_000
const MAX_PAGES_PER_EXTRACTION = 10
const MAX_PAGE_TEXT_CHARS = 32_000

export async function inspectPdf(content: Uint8Array): Promise<{ pageCount: number }> {
  const task = getDocument({
    data: Uint8Array.from(content),
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: false,
    verbosity: VerbosityLevel.ERRORS
  })
  try {
    const document = await task.promise
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit`)
    }
    return { pageCount: document.numPages }
  } finally {
    await task.destroy()
  }
}

function textFromItems(items: readonly unknown[]): string {
  let text = ''
  for (const value of items) {
    if (!value || typeof value !== 'object' || !('str' in value)) {
      continue
    }
    const item = value as { str?: unknown; hasEOL?: unknown }
    if (typeof item.str !== 'string' || !item.str) {
      continue
    }
    if (text && !/[\s\n]$/.test(text)) {
      text += ' '
    }
    text += item.str
    if (item.hasEOL === true) {
      text += '\n'
    }
  }
  return text.trim()
}

export async function extractPdfPages(
  content: Uint8Array,
  cursor: number,
  requestedLimit: number
): Promise<{ pageCount: number; items: LocalDocumentItem[]; nextCursor?: number }> {
  const task = getDocument({
    data: Uint8Array.from(content),
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: false,
    verbosity: VerbosityLevel.ERRORS
  })
  try {
    const document = await task.promise
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page limit`)
    }
    const start = Math.min(cursor, document.numPages)
    const end = Math.min(
      start + Math.min(requestedLimit, MAX_PAGES_PER_EXTRACTION),
      document.numPages
    )
    const items: LocalDocumentItem[] = []
    for (let pageIndex = start; pageIndex < end; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1)
      const contentItems = await page.getTextContent({ disableNormalization: false })
      const fullText = textFromItems(contentItems.items)
      items.push({
        kind: 'pdf_page',
        page: pageIndex + 1,
        text: fullText.slice(0, MAX_PAGE_TEXT_CHARS),
        ...(fullText.length > MAX_PAGE_TEXT_CHARS ? { truncated: true } : {})
      })
      page.cleanup()
    }
    return {
      pageCount: document.numPages,
      items,
      ...(end < document.numPages ? { nextCursor: end } : {})
    }
  } finally {
    await task.destroy()
  }
}
