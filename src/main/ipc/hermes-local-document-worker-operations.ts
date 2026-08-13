import { extractPdfPages, inspectPdf } from './hermes-local-document-pdf'
import {
  applyPptxTranslations,
  extractPptxParagraphs,
  inspectPptx,
  parsePptx
} from './hermes-local-document-pptx'
import {
  applyXlsxTranslations,
  extractXlsxCells,
  inspectXlsx,
  parseXlsx
} from './hermes-local-document-xlsx'
import type {
  LocalDocumentWorkerRequest,
  LocalDocumentWorkerValue
} from './hermes-local-document-worker-protocol'

function validateSignature(request: LocalDocumentWorkerRequest): void {
  if (request.format === 'pdf') {
    const signature = new TextDecoder('ascii').decode(request.data.subarray(0, 5))
    if (signature !== '%PDF-') {
      throw new Error('file content is not a PDF document')
    }
    return
  }
  if (request.data[0] !== 0x50 || request.data[1] !== 0x4b) {
    throw new Error(`file content is not a ${request.format.toUpperCase()} document`)
  }
}

export async function executeLocalDocumentWorkerOperation(
  request: LocalDocumentWorkerRequest
): Promise<LocalDocumentWorkerValue> {
  validateSignature(request)
  if (request.format === 'pdf') {
    if (request.kind === 'inspect') {
      return { format: 'pdf', ...(await inspectPdf(request.data)) }
    }
    if (request.kind !== 'extract') {
      throw new Error('PDF documents do not support translation application')
    }
    return {
      format: 'pdf',
      ...(await extractPdfPages(request.data, request.cursor, request.limit))
    }
  }
  if (request.format === 'pptx') {
    const parsed = parsePptx(request.data)
    if (request.kind === 'inspect') {
      return { format: 'pptx', ...inspectPptx(parsed) }
    }
    if (request.kind === 'extract') {
      return {
        format: 'pptx',
        ...inspectPptx(parsed),
        ...extractPptxParagraphs(parsed, request.cursor, request.limit)
      }
    }
    return {
      format: 'pptx',
      output: applyPptxTranslations(parsed, request.translations),
      appliedCount: request.translations.length
    }
  }
  const parsed = parseXlsx(request.data)
  if (request.kind === 'inspect') {
    return { format: 'xlsx', sheets: inspectXlsx(parsed) }
  }
  if (request.kind === 'extract') {
    return {
      format: 'xlsx',
      sheets: inspectXlsx(parsed),
      ...extractXlsxCells(parsed, request.cursor, request.limit)
    }
  }
  return {
    format: 'xlsx',
    output: applyXlsxTranslations(parsed, request.translations),
    appliedCount: request.translations.length
  }
}
