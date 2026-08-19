export type LocalDocumentTranslation = {
  sheet: string
  cell: string
  sourceText: string
  translatedText: string
}

export type LocalPresentationTranslation = {
  slide: number
  paragraph: number
  sourceText: string
  translatedText: string
}

export type LocalOfficeDocumentEdit = Record<string, unknown> & { kind: string }
export type LocalOfficeDocumentSpec = Record<string, unknown>

export type LocalDocumentOperation =
  | { id: string; kind: 'inspect'; path: string }
  | { id: string; kind: 'extract'; path: string; cursor?: number; limit?: number }
  | {
      id: string
      kind: 'apply_xlsx_translation'
      path: string
      outputPath: string
      expectedSha256: string
      translations: LocalDocumentTranslation[]
    }
  | {
      id: string
      kind: 'apply_pptx_translation'
      path: string
      outputPath: string
      expectedSha256: string
      translations: LocalPresentationTranslation[]
    }
  | {
      id: string
      kind: 'create_pptx' | 'create_pdf'
      outputPath: string
      documentSpec: LocalOfficeDocumentSpec
    }
  | {
      id: string
      kind: 'edit_pptx' | 'edit_pdf'
      path: string
      outputPath: string
      expectedSha256: string
      edits: LocalOfficeDocumentEdit[]
    }

export type LocalDocumentRequest = { version: 1; operations: LocalDocumentOperation[] }
export type LocalDocumentAttachment = { path: string; artifactId: string; sha256?: string }

export type LocalDocumentSheetSummary = {
  name: string
  cellCount: number
  textCellCount: number
  numericCellCount: number
  formulaCellCount: number
}

export type LocalDocumentItem =
  | { kind: 'pdf_page'; page: number; text: string; truncated?: boolean }
  | {
      kind: 'xlsx_cell'
      sheet: string
      cell: string
      text: string
      valueType: 'text' | 'number' | 'boolean' | 'date' | 'error' | 'formula'
      rawValue?: string
      formula?: string
      numberFormat?: string
    }
  | { kind: 'pptx_paragraph'; slide: number; paragraph: number; text: string }

export type LocalDocumentResult = {
  id: string
  ok: boolean
  path?: string
  outputPath?: string
  format?: 'pdf' | 'xlsx' | 'pptx'
  sha256?: string
  pageCount?: number
  textCharacterCount?: number
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
  appliedCount?: number
  error?: string
}
