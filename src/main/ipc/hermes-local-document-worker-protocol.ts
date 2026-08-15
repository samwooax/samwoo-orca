import type {
  LocalDocumentItem,
  LocalDocumentSheetSummary,
  LocalDocumentTranslation,
  LocalPresentationTranslation
} from './hermes-local-document-protocol'

export type LocalDocumentWorkerRequest =
  | { kind: 'inspect'; format: 'pdf' | 'xlsx' | 'pptx'; data: Uint8Array }
  | {
      kind: 'extract'
      format: 'pdf' | 'xlsx' | 'pptx'
      data: Uint8Array
      cursor: number
      limit: number
    }
  | {
      kind: 'apply_xlsx_translation'
      format: 'xlsx'
      data: Uint8Array
      translations: LocalDocumentTranslation[]
    }
  | {
      kind: 'apply_pptx_translation'
      format: 'pptx'
      data: Uint8Array
      translations: LocalPresentationTranslation[]
    }

export type LocalDocumentWorkerValue = {
  format: 'pdf' | 'xlsx' | 'pptx'
  pageCount?: number
  slideCount?: number
  sheets?: LocalDocumentSheetSummary[]
  slides?: {
    index: number
    textParagraphCount: number
    tableCount: number
    chartCount: number
    imageCount: number
  }[]
  items?: LocalDocumentItem[]
  nextCursor?: number
  output?: Uint8Array
  appliedCount?: number
}

export type LocalDocumentWorkerResponse =
  | { ok: true; value: LocalDocumentWorkerValue }
  | { ok: false; error: string }
