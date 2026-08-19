import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import { join, resolve } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {
  assertOfficePreview,
  assertWorkerManifest
} from './hermes-local-document-bundle-smoke-assertions.mjs'

const workerPath = resolve('out/main/hermes-local-document-worker-entry.js')
const NODE_WORKER_TIMEOUT_MS = 60_000
const OFFICE_WORKER_TIMEOUT_MS = 180_000
const MAX_OFFICE_STDOUT_CHARS = 2 * 1024 * 1024
const MAX_OFFICE_STDERR_CHARS = 64 * 1024

function run(workerData) {
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(workerPath, { workerData })
    let settled = false
    let terminating = false
    const finish = (error, value) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
      } else {
        resolveResult(value)
      }
    }
    const timer = setTimeout(() => {
      terminating = true
      void worker
        .terminate()
        .then(() => finish(new Error('Bundled document worker timed out')))
        .catch((error) => finish(error))
    }, NODE_WORKER_TIMEOUT_MS)
    worker.once('message', (value) => {
      terminating = true
      void worker
        .terminate()
        .then(() => finish(null, value))
        .catch((error) => finish(error))
    })
    worker.once('error', (error) => finish(error))
    worker.once('exit', (code) => {
      if (!settled && !terminating) {
        finish(new Error(`Bundled document worker exited without a result (${code})`))
      }
    })
  })
}

function waitForClose(worker, timeoutMs = 2_000) {
  if (worker.exitCode !== null || worker.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolveClose) => {
    let finished = false
    const finish = () => {
      if (finished) {
        return
      }
      finished = true
      clearTimeout(timer)
      worker.off('close', finish)
      resolveClose()
    }
    const timer = setTimeout(finish, timeoutMs)
    worker.once('close', finish)
  })
}

async function terminateOfficeWorker(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null) {
    return
  }
  if (process.platform === 'win32' && worker.pid) {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR
    if (systemRoot) {
      const taskkill = spawn(
        join(systemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(worker.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' }
      )
      await new Promise((resolveKill) => {
        let finished = false
        const finish = () => {
          if (finished) {
            return
          }
          finished = true
          clearTimeout(timer)
          resolveKill()
        }
        const timer = setTimeout(() => {
          taskkill.kill('SIGKILL')
          finish()
        }, 5_000)
        taskkill.once('error', finish)
        taskkill.once('close', finish)
      })
    }
  } else if (worker.pid) {
    try {
      process.kill(-worker.pid, 'SIGKILL')
    } catch {
      worker.kill('SIGKILL')
    }
  }
  if (worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGKILL')
  }
  await waitForClose(worker)
}

function runOfficeWorker(executable, payload) {
  return new Promise((resolveResult, reject) => {
    const worker = spawn(executable, [], {
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settling = false
    const settle = (error, value) => {
      clearTimeout(timer)
      if (error) {
        reject(error)
      } else {
        resolveResult(value)
      }
    }
    const failAfterTeardown = (error) => {
      if (settling) {
        return
      }
      settling = true
      void terminateOfficeWorker(worker).then(
        () => settle(error),
        (cleanupError) => settle(cleanupError)
      )
    }
    const timer = setTimeout(
      () => failAfterTeardown(new Error('Office document worker timed out')),
      OFFICE_WORKER_TIMEOUT_MS
    )
    worker.stdout.setEncoding('utf8')
    worker.stderr.setEncoding('utf8')
    worker.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > MAX_OFFICE_STDOUT_CHARS) {
        failAfterTeardown(new Error('Office document worker output exceeded its limit'))
      }
    })
    worker.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_OFFICE_STDERR_CHARS)
    })
    worker.once('error', (error) => {
      if (!settling) {
        settling = true
        settle(error)
      }
    })
    worker.once('close', (code) => {
      if (settling) {
        return
      }
      settling = true
      if (process.env.ORCA_ARTIFACT_DEBUG === '1' && stderr.trim()) {
        process.stderr.write(stderr)
      }
      if (code !== 0 || !stdout.trim()) {
        settle(new Error(`Office document worker failed (${code}): ${stderr}`))
        return
      }
      try {
        settle(null, JSON.parse(stdout.trim()))
      } catch {
        settle(new Error('Office document worker returned invalid JSON'))
      }
    })
    worker.stdin.end(`${JSON.stringify(payload)}\n`)
  })
}

function assertUnsafeWorkbookRejected(value, label) {
  if (
    value.ok !== false ||
    value.error?.code !== 'input_format_invalid' ||
    value.error?.details?.stage !== 'preview_security'
  ) {
    throw new Error(`${label} preview safety contract failed: ${JSON.stringify(value)}`)
  }
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
  const libreOfficePath = join(resolve(executable, '..'), 'libreoffice', 'program', 'soffice.exe')
  if (!existsSync(libreOfficePath)) {
    throw new Error(`Bundled LibreOffice is missing: ${libreOfficePath}`)
  }
  const bundleRoot = resolve(executable, '..')
  await assertWorkerManifest(bundleRoot, 'before rendering')
  const directory = await mkdtemp(join(tmpdir(), 'orca-office-document-smoke-'))
  try {
    const invalidWorkbook = await runOfficeWorker(executable, {
      hostAction: 'run',
      jobId: 'excel-smoke-invalid',
      workspace: directory,
      artifacts: [],
      request: {
        version: 1,
        operationId: 'excel-smoke-invalid',
        idempotencyKey: 'excel-smoke-invalid-key',
        action: 'create',
        output: { path: 'invalid.xlsx' },
        workbookSpec: { version: 1, sheets: [{ name: 'Summary', state: 'visible' }] },
        validation: { openXml: true, formulas: true, charts: true, renderPreview: false },
        toolchain: { profile: 'excel-artifact-v1', version: '1' },
        timeoutSeconds: 60
      }
    })
    if (
      invalidWorkbook.ok !== false ||
      invalidWorkbook.error?.code !== 'protocol_invalid' ||
      invalidWorkbook.error?.details?.stage !== 'schema'
    ) {
      throw new Error(`Bundled Excel error contract failed: ${JSON.stringify(invalidWorkbook)}`)
    }

    const workbookPath = join(directory, 'from-pdf.xlsx')
    const workbook = await runOfficeWorker(executable, {
      hostAction: 'run',
      jobId: 'excel-smoke-create',
      workspace: directory,
      artifacts: [],
      request: {
        version: 1,
        operationId: 'excel-smoke-create',
        idempotencyKey: 'excel-smoke-create-key',
        action: 'create',
        output: { path: 'from-pdf.xlsx', overwrite: false, expectedSha256: null },
        workbookSpec: {
          version: 1,
          preservationPolicy: 'fail_on_unsupported_loss',
          sheets: [
            {
              name: 'Summary',
              state: 'visible',
              data: [
                ['항목', '내용'],
                ['문서', '무라타 회사 개요'],
                ['페이지', 6]
              ],
              columns: [
                { range: 'A', width: 18 },
                { range: 'B', width: 36 }
              ],
              rows: [{ index: 1, height: 24 }],
              autofilter: { range: 'A1:B3' },
              pageSetup: { orientation: 'landscape', fitToWidth: 1 }
            }
          ]
        },
        validation: { openXml: true, formulas: true, charts: true, renderPreview: false },
        toolchain: { profile: 'excel-artifact-v1', version: '1' },
        timeoutSeconds: 60
      }
    })
    if (workbook.state !== 'completed' || !workbook.committed || !existsSync(workbookPath)) {
      throw new Error(`Bundled Excel creation failed: ${JSON.stringify(workbook)}`)
    }
    const verifiedWorkbook = await run({
      kind: 'extract',
      format: 'xlsx',
      data: new Uint8Array(await readFile(workbookPath)),
      cursor: 0,
      limit: 20
    })
    if (
      !verifiedWorkbook.ok ||
      !verifiedWorkbook.value.items?.some((item) => item.text === '무라타 회사 개요')
    ) {
      throw new Error(
        `Bundled created Excel verification failed: ${JSON.stringify(verifiedWorkbook)}`
      )
    }

    const workbookPreview = await runOfficeWorker(executable, {
      hostAction: 'officePreview',
      previewRequest: {
        sourcePath: workbookPath,
        libreOfficePath,
        kind: 'xlsx',
        startIndex: 1,
        count: 4
      }
    })
    await assertOfficePreview(workbookPreview, 'XLSX')

    const macroWorkbookPath = join(directory, 'unsafe-macro.xlsx')
    const macroWorkbook = unzipSync(new Uint8Array(await readFile(workbookPath)))
    macroWorkbook['xl/vbaProject.bin'] = strToU8('preview safety fixture')
    await writeFile(macroWorkbookPath, zipSync(macroWorkbook))
    assertUnsafeWorkbookRejected(
      await runOfficeWorker(executable, {
        hostAction: 'officePreview',
        previewRequest: {
          sourcePath: macroWorkbookPath,
          libreOfficePath,
          kind: 'xlsx',
          startIndex: 1,
          count: 1
        }
      }),
      'XLSX macro'
    )

    const externalWorkbookPath = join(directory, 'unsafe-external.xlsx')
    const externalWorkbook = unzipSync(new Uint8Array(await readFile(workbookPath)))
    const relationshipsPath = 'xl/_rels/workbook.xml.rels'
    const relationships = Buffer.from(externalWorkbook[relationshipsPath]).toString('utf8')
    externalWorkbook[relationshipsPath] = strToU8(
      relationships.replace(
        '</Relationships>',
        '<Relationship Id="rIdOrcaUnsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/data.xlsx" TargetMode="eXtErNaL"/></Relationships>'
      )
    )
    await writeFile(externalWorkbookPath, zipSync(externalWorkbook))
    assertUnsafeWorkbookRejected(
      await runOfficeWorker(executable, {
        hostAction: 'officePreview',
        previewRequest: {
          sourcePath: externalWorkbookPath,
          libreOfficePath,
          kind: 'xlsx',
          startIndex: 1,
          count: 1
        }
      }),
      'XLSX external relationship'
    )

    const presentationPath = join(directory, 'visual-check.pptx')
    const presentation = await runOfficeWorker(executable, {
      hostAction: 'document',
      documentRequest: {
        action: 'create_pptx',
        outputPath: presentationPath,
        artifacts: [],
        documentSpec: {
          layout: 'widescreen',
          slides: [
            {
              title: 'Hermes visual verification',
              elements: [
                {
                  type: 'text',
                  text: 'LibreOffice rendered this slide for the vision model.',
                  x: 1,
                  y: 2,
                  width: 10,
                  height: 1,
                  fontSize: 24
                }
              ]
            }
          ]
        }
      }
    })
    if (!presentation.ok || !existsSync(presentationPath)) {
      throw new Error(`Bundled PPTX creation failed: ${JSON.stringify(presentation)}`)
    }
    const presentationPreview = await runOfficeWorker(executable, {
      hostAction: 'officePreview',
      previewRequest: {
        sourcePath: presentationPath,
        libreOfficePath,
        kind: 'pptx',
        startIndex: 1,
        count: 4
      }
    })
    await assertOfficePreview(presentationPreview, 'PPTX')

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
                  height: 2,
                  fontSize: 11,
                  lineHeight: 15,
                  text: '한국어 PDF 번역 검증 본문이 실제로 보여야 합니다. '.repeat(25).trim()
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
    await assertWorkerManifest(bundleRoot, 'after rendering')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

console.log(
  '[hermes-local-document-bundle-smoke] extraction, creation, and LibreOffice visual previews passed'
)
