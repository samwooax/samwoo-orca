import { describe, expect, it } from 'vitest'
import {
  excelArtifactProtocolPrompt,
  formatExcelArtifactResult,
  parseExcelArtifactRequest
} from './hermes-excel-artifact-protocol'

describe('Excel Artifact protocol', () => {
  it('accepts one exact v1 envelope', () => {
    const request = {
      version: 1,
      operationId: 'operation-001',
      idempotencyKey: 'idempotency-key-0001',
      action: 'create',
      output: { path: 'reports/kpi.xlsx', overwrite: false, expectedSha256: null },
      workbookSpec: { version: 1, sheets: [{ name: 'Summary', state: 'visible' }] },
      validation: { openXml: true, formulas: true, charts: true, renderPreview: false },
      toolchain: { profile: 'excel-artifact-v1', version: '1' },
      timeoutSeconds: 60
    }
    const envelope = `<orca_excel_artifact>${JSON.stringify(request)}</orca_excel_artifact>`

    expect(parseExcelArtifactRequest(envelope)).toEqual(request)
    expect(parseExcelArtifactRequest(`text${envelope}`)).toBeNull()
    expect(parseExcelArtifactRequest(`${envelope}\ntext`)).toBeNull()
  })

  it('normalizes safe model aliases before worker validation', () => {
    const request = {
      version: 1,
      operationId: 'operation-legacy-001',
      idempotencyKey: 'idempotency-legacy-0001',
      action: 'create',
      output: { path: 'reports/from-pdf.xlsx' },
      workbookSpec: {
        version: 1,
        preservationPolicy: 'new_workbook',
        sheets: [
          {
            name: 'Summary',
            state: 'visible',
            columns: [{ column: 'A', width: 24 }],
            rows: [{ row: 1, height: 30 }],
            autofilter: 'A1:C25',
            pageSetup: { orientation: 'landscape', fitToWidth: 1 }
          }
        ]
      },
      validation: { requiredSheets: ['Summary'], requiredCells: ['Summary!A1'] },
      toolchain: { profile: 'excel-artifact-v1', version: '1' },
      timeoutSeconds: 60
    }
    const envelope = `<orca_excel_artifact>${JSON.stringify(request)}</orca_excel_artifact>`

    expect(parseExcelArtifactRequest(envelope)).toMatchObject({
      output: { path: 'reports/from-pdf.xlsx', overwrite: false },
      workbookSpec: {
        preservationPolicy: 'fail_on_unsupported_loss',
        sheets: [
          {
            columns: [{ range: 'A', width: 24 }],
            rows: [{ index: 1, height: 30 }],
            autofilter: { range: 'A1:C25' },
            pageSetup: { orientation: 'landscape', fitToWidth: 1 }
          }
        ]
      },
      validation: { openXml: true, formulas: true, charts: true, renderPreview: false }
    })
  })

  it('keeps conflicting aliases for strict worker rejection', () => {
    const request = {
      version: 1,
      operationId: 'operation-conflict-001',
      idempotencyKey: 'idempotency-conflict-0001',
      action: 'create',
      output: { path: 'reports/conflict.xlsx' },
      workbookSpec: {
        version: 1,
        sheets: [
          {
            name: 'Summary',
            state: 'visible',
            columns: [{ column: 'A', range: 'B' }]
          }
        ]
      },
      toolchain: { profile: 'excel-artifact-v1', version: '1' },
      timeoutSeconds: 60
    }
    const envelope = `<orca_excel_artifact>${JSON.stringify(request)}</orca_excel_artifact>`

    expect(parseExcelArtifactRequest(envelope)?.workbookSpec).toMatchObject({
      sheets: [{ columns: [{ column: 'A', range: 'B' }] }]
    })
  })

  it('advertises only main-produced capabilities', () => {
    expect(excelArtifactProtocolPrompt(null)).toContain('capability: unavailable')
    const prompt = excelArtifactProtocolPrompt({
      name: 'excelArtifact',
      protocolVersions: [1],
      actions: ['create', 'modify', 'validate', 'cancel'],
      inputKinds: ['xlsx'],
      executionHosts: ['local'],
      workbookSpecVersions: [1],
      workbookFeatures: ['cells'],
      create: { name: 'xlsxwriter', version: '3.2.9', available: true },
      modify: { name: 'openpyxl', version: '3.1.5', available: true },
      validate: { name: 'openpyxl', version: '3.1.5', available: true },
      render: { name: 'libreoffice', version: 'unavailable', available: false },
      pptxInspect: false,
      pdfInspect: false,
      maxInputBytes: 64,
      maxTimeoutSeconds: 600
    })
    expect(prompt).toContain('<orca_excel_artifact>')
    expect(prompt).toContain('"overwrite":false')
    expect(prompt).toContain('"renderPreview":false')
    expect(prompt).toContain('{"range":"A"}')
    expect(prompt).toContain('{"index":1,"height":24}')
    expect(prompt).toContain('fitToWidth')
    expect(formatExcelArtifactResult({ state: 'completed', committed: true })).toBe(
      '<orca_excel_artifact_result>{"state":"completed","committed":true}</orca_excel_artifact_result>'
    )
  })
})
