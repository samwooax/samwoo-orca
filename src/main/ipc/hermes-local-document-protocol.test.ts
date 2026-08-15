import { describe, expect, it } from 'vitest'
import {
  LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT,
  formatLocalDocumentResults,
  parseLocalDocumentRequest
} from './hermes-local-document-protocol'

describe('Hermes local document protocol', () => {
  it('accepts bounded PDF extraction and XLSX translation requests', () => {
    const hash = 'a'.repeat(64)
    const reply = `<orca_local_documents>${JSON.stringify({
      version: 1,
      operations: [
        { id: 'pdf', kind: 'extract', path: 'docs/report.pdf', cursor: 2, limit: 10 },
        {
          id: 'xlsx',
          kind: 'apply_xlsx_translation',
          path: 'KPI.xlsx',
          outputPath: 'KPI_ko.xlsx',
          expectedSha256: hash,
          translations: [
            { sheet: 'Dashboard', cell: 'B4', sourceText: 'Revenue', translatedText: '매출' }
          ]
        }
      ]
    })}</orca_local_documents>`

    expect(parseLocalDocumentRequest(reply)).toEqual({
      version: 1,
      operations: [
        { id: 'pdf', kind: 'extract', path: 'docs/report.pdf', cursor: 2, limit: 10 },
        {
          id: 'xlsx',
          kind: 'apply_xlsx_translation',
          path: 'KPI.xlsx',
          outputPath: 'KPI_ko.xlsx',
          expectedSha256: hash,
          translations: [
            { sheet: 'Dashboard', cell: 'B4', sourceText: 'Revenue', translatedText: '매출' }
          ]
        }
      ]
    })
  })

  it('caps oversized extraction requests and rejects invalid translation targets', () => {
    const oversized =
      '<orca_local_documents>{"version":1,"operations":[{"id":"pdf","kind":"extract","path":"a.pdf","limit":500}]}</orca_local_documents>'
    const duplicate = `<orca_local_documents>${JSON.stringify({
      version: 1,
      operations: [
        {
          id: 'xlsx',
          kind: 'apply_xlsx_translation',
          path: 'a.xlsx',
          outputPath: 'b.xlsx',
          expectedSha256: 'b'.repeat(64),
          translations: [
            { sheet: 'S', cell: 'A1', sourceText: 'a', translatedText: '가' },
            { sheet: 'S', cell: 'A1', sourceText: 'b', translatedText: '나' }
          ]
        }
      ]
    })}</orca_local_documents>`

    expect(parseLocalDocumentRequest(oversized)).toEqual({
      version: 1,
      operations: [{ id: 'pdf', kind: 'extract', path: 'a.pdf', limit: 200 }]
    })
    expect(
      parseLocalDocumentRequest(
        '<orca_local_documents>{"version":1,"operations":[{"id":"pdf","kind":"extract","path":"a.pdf","limit":0}]}</orca_local_documents>'
      )
    ).toBeNull()
    expect(parseLocalDocumentRequest(duplicate)).toBeNull()
    expect(
      parseLocalDocumentRequest(
        '<orca_local_documents>{"version":1,"operations":[{"id":"pdf","kind":"inspect","path":"a.pdf","unknown":true}]}</orca_local_documents>'
      )
    ).toBeNull()
  })

  it('keeps binary-document guidance and results in dedicated envelopes', () => {
    expect(LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT).toContain('PDF/XLSX/PPTX가 바이너리라')
    expect(LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT).toContain('limit must be 1..200')
    expect(LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT).toContain('nextCursor')
    expect(formatLocalDocumentResults([{ id: 'pdf', ok: true, pageCount: 3 }])).toBe(
      '<orca_local_document_results>{"version":1,"results":[{"id":"pdf","ok":true,"pageCount":3}]}</orca_local_document_results>'
    )
  })

  it('accepts bounded PPTX and PDF creation and editing requests', () => {
    const hash = 'c'.repeat(64)
    const reply = `<orca_local_documents>${JSON.stringify({
      version: 1,
      operations: [
        {
          id: 'deck',
          kind: 'create_pptx',
          outputPath: 'deck.pptx',
          documentSpec: {
            layout: 'widescreen',
            slides: [{ title: 'KPI', elements: [{ type: 'text', text: 'Revenue' }] }]
          }
        },
        {
          id: 'pdf',
          kind: 'edit_pdf',
          path: 'report.pdf',
          outputPath: 'report-marked.pdf',
          expectedSha256: hash,
          edits: [{ kind: 'watermark', text: 'CONFIDENTIAL' }]
        }
      ]
    })}</orca_local_documents>`

    expect(parseLocalDocumentRequest(reply)).toMatchObject({
      operations: [
        { id: 'deck', kind: 'create_pptx', outputPath: 'deck.pptx' },
        { id: 'pdf', kind: 'edit_pdf', expectedSha256: hash }
      ]
    })
    expect(LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT).toContain('[일반 문서 생성·편집]')
  })

  it('accepts visible PDF text elements and rejects blank or unsupported pages', () => {
    const operation = {
      id: 'pdf',
      kind: 'create_pdf',
      outputPath: 'translated.pdf',
      documentSpec: {
        pageSize: 'A4',
        pages: [
          {
            elements: [
              {
                type: 'text',
                x: 0.7,
                y: 0.7,
                width: 6.9,
                height: 9.5,
                fontSize: 11,
                lineHeight: 15,
                bold: false,
                color: '#111111',
                align: 'left',
                text: '한국어 번역'
              }
            ]
          }
        ]
      }
    }
    const envelope = (value: unknown): string =>
      `<orca_local_documents>${JSON.stringify({ version: 1, operations: [value] })}</orca_local_documents>`

    expect(parseLocalDocumentRequest(envelope(operation))).toMatchObject({
      operations: [{ id: 'pdf', kind: 'create_pdf', outputPath: 'translated.pdf' }]
    })
    expect(
      parseLocalDocumentRequest(
        envelope({ ...operation, documentSpec: { pageSize: 'A4', pages: [{ elements: [] }] } })
      )
    ).toBeNull()
    expect(
      parseLocalDocumentRequest(
        envelope({
          ...operation,
          documentSpec: { pageSize: 'A4', pages: [{ elements: [{ type: 'image' }] }] }
        })
      )
    ).toBeNull()
    expect(LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT).toContain('expectedSha256')
    expect(LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT).toContain('textCharacterCount')
  })
})
