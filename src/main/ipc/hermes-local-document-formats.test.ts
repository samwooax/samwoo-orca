import { describe, expect, it } from 'vitest'
import { strToU8, unzipSync, zipSync } from 'fflate'
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

function xlsxFixture(): Uint8Array {
  const archive = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dashboard" sheetId="1" r:id="rId1"/><sheet name="Formula" sheetId="2" r:id="rId2"/></sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'
    ),
    'xl/sharedStrings.xml': strToU8(
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Revenue</t></si></sst>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="2" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t xml:space="preserve"> Keep </t></is></c><c r="C1" t="str"><f>CONCAT("x")</f><v>Formula</v></c><c r="D1"><v>42</v></c></row></sheetData></worksheet>'
    ),
    'xl/worksheets/sheet2.xml': strToU8(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>SUM(1,2)</f><v>3</v></c></row></sheetData></worksheet>'
    ),
    'xl/media/image1.png': new Uint8Array([1, 2, 3, 4])
  }
  return zipSync(archive)
}

function pdfFixture(): Uint8Array {
  const stream = 'BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let content = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(content, 'ascii'))
    content += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = Buffer.byteLength(content, 'ascii')
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  content += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return strToU8(content)
}

function pptxFixture(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>'
    ),
    'ppt/presentation.xml': strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>'
    ),
    'ppt/slides/slide1.xml': strToU8(
      '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>Hello </a:t></a:r><a:r><a:rPr i="1"/><a:t>world</a:t></a:r></a:p></p:txBody></p:sp><a:tbl/><c:chart/><a:blip/></p:spTree></p:cSld></p:sld>'
    ),
    'ppt/media/image1.png': new Uint8Array([1, 2, 3, 4])
  })
}

describe('Hermes XLSX document processing', () => {
  it('extracts only text cells and preserves formulas, styles, and binary entries', () => {
    const fixture = xlsxFixture()
    const originalArchive = unzipSync(fixture)
    const parsed = parseXlsx(fixture)

    expect(inspectXlsx(parsed)).toEqual([
      { name: 'Dashboard', textCellCount: 2 },
      { name: 'Formula', textCellCount: 0 }
    ])
    expect(extractXlsxCells(parsed, 0, 200)).toEqual({
      items: [
        { kind: 'xlsx_cell', sheet: 'Dashboard', cell: 'A1', text: 'Revenue' },
        { kind: 'xlsx_cell', sheet: 'Dashboard', cell: 'B1', text: ' Keep ' }
      ]
    })

    const output = applyXlsxTranslations(parsed, [
      { sheet: 'Dashboard', cell: 'A1', sourceText: 'Revenue', translatedText: '매출' }
    ])
    const verified = parseXlsx(output)
    expect(extractXlsxCells(verified, 0, 200).items[0]).toMatchObject({ text: '매출' })
    const archive = unzipSync(output)
    const worksheet = new TextDecoder().decode(archive['xl/worksheets/sheet1.xml'])
    expect(worksheet).toContain('s="2"')
    expect(worksheet).toContain('<f>CONCAT("x")</f>')
    expect(archive['xl/worksheets/sheet2.xml']).toEqual(originalArchive['xl/worksheets/sheet2.xml'])
    expect(archive['xl/media/image1.png']).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('refuses to apply a translation when the extracted source text changed', () => {
    const parsed = parseXlsx(xlsxFixture())
    expect(() =>
      applyXlsxTranslations(parsed, [
        { sheet: 'Dashboard', cell: 'A1', sourceText: 'Cost', translatedText: '비용' }
      ])
    ).toThrow('XLSX source text changed')
  })
})

describe('Hermes PDF document processing', () => {
  it('inspects and extracts text from a PDF page', async () => {
    const pdf = pdfFixture()
    await expect(inspectPdf(pdf)).resolves.toEqual({ pageCount: 1 })
    await expect(extractPdfPages(pdf, 0, 10)).resolves.toEqual({
      pageCount: 1,
      items: [{ kind: 'pdf_page', page: 1, text: 'Hello PDF' }]
    })
  })
})

describe('Hermes PPTX document processing', () => {
  it('extracts slide paragraphs and changes only selected text runs', () => {
    const fixture = pptxFixture()
    const originalArchive = unzipSync(fixture)
    const parsed = parsePptx(fixture)

    expect(inspectPptx(parsed)).toEqual({
      slideCount: 1,
      slides: [
        {
          index: 1,
          textParagraphCount: 1,
          tableCount: 1,
          chartCount: 1,
          imageCount: 1
        }
      ]
    })
    expect(extractPptxParagraphs(parsed, 0, 200)).toEqual({
      items: [{ kind: 'pptx_paragraph', slide: 1, paragraph: 1, text: 'Hello world' }]
    })

    const output = applyPptxTranslations(parsed, [
      {
        slide: 1,
        paragraph: 1,
        sourceText: 'Hello world',
        translatedText: '안녕하세요'
      }
    ])
    expect(extractPptxParagraphs(parsePptx(output), 0, 200).items[0]).toMatchObject({
      text: '안녕하세요'
    })
    const archive = unzipSync(output)
    const slide = new TextDecoder().decode(archive['ppt/slides/slide1.xml'])
    expect(slide).toContain('b="1"')
    expect(slide).toContain('i="1"')
    expect(archive['ppt/media/image1.png']).toEqual(originalArchive['ppt/media/image1.png'])
  })

  it('refuses external presentation relationships', () => {
    const archive = unzipSync(pptxFixture())
    archive['ppt/slides/_rels/slide1.xml.rels'] = strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>'
    )
    expect(() => parsePptx(zipSync(archive))).toThrow('external PPTX relationships')
  })
})
