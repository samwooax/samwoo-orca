import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import { join, resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'

const workerPath = resolve('out/main/hermes-local-document-worker-entry.js')

function run(workerData) {
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(workerPath, { workerData })
    worker.once('message', resolveResult)
    worker.once('error', reject)
  })
}

function runOfficeWorker(executable, payload) {
  return new Promise((resolveResult, reject) => {
    const worker = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    worker.stdout.setEncoding('utf8')
    worker.stderr.setEncoding('utf8')
    worker.stdout.on('data', (chunk) => (stdout += chunk))
    worker.stderr.on('data', (chunk) => (stderr += chunk))
    worker.once('error', reject)
    worker.once('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(`Office document worker failed (${code}): ${stderr}`))
        return
      }
      resolveResult(JSON.parse(stdout.trim()))
    })
    worker.stdin.end(`${JSON.stringify(payload)}\n`)
  })
}

function xlsxFixture() {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dashboard" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    ),
    'xl/sharedStrings.xml': strToU8(
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Revenue</t></si></sst>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'
    )
  })
}

function pdfFixture() {
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
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content, 'ascii'))
    content += `${index + 1} 0 obj\n${object}\nendobj\n`
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

const [xlsx, pdf] = await Promise.all([
  run({ kind: 'extract', format: 'xlsx', data: xlsxFixture(), cursor: 0, limit: 10 }),
  run({ kind: 'extract', format: 'pdf', data: pdfFixture(), cursor: 0, limit: 10 })
])

if (!xlsx.ok || xlsx.value.items?.[0]?.text !== 'Revenue') {
  throw new Error(`Bundled XLSX worker smoke failed: ${JSON.stringify(xlsx)}`)
}
if (!pdf.ok || pdf.value.items?.[0]?.text !== 'Hello PDF') {
  throw new Error(`Bundled PDF worker smoke failed: ${JSON.stringify(pdf)}`)
}

if (process.platform === 'win32' && process.arch === 'x64') {
  const executable = resolve(
    'resources',
    'hermes-excel-artifact-worker',
    'win32-x64',
    'orca-excel-artifact-worker',
    'orca-excel-artifact-worker.exe'
  )
  if (!existsSync(executable)) {
    throw new Error(`Bundled office document worker is missing: ${executable}`)
  }
  const directory = await mkdtemp(join(tmpdir(), 'orca-office-document-smoke-'))
  try {
    const outputPath = join(directory, '한국어-번역.pdf')
    const created = await runOfficeWorker(executable, {
      hostAction: 'document',
      documentRequest: {
        action: 'create_pdf',
        outputPath,
        artifacts: [],
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
                  text: '한국어 PDF 번역 검증'
                }
              ]
            }
          ]
        }
      }
    })
    if (!created.ok || created.textCharacterCount < 1) {
      throw new Error(`Bundled PDF creation failed: ${JSON.stringify(created)}`)
    }
    const verified = await run({
      kind: 'extract',
      format: 'pdf',
      data: new Uint8Array(await readFile(outputPath)),
      cursor: 0,
      limit: 10
    })
    if (!verified.ok || !verified.value.items?.[0]?.text.includes('한국어 PDF 번역 검증')) {
      throw new Error(`Bundled created PDF verification failed: ${JSON.stringify(verified)}`)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

console.log('[hermes-local-document-bundle-smoke] extraction and visible PDF creation passed')
