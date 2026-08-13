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

  it('advertises only main-produced capabilities', () => {
    expect(excelArtifactProtocolPrompt(null)).toContain('capability: unavailable')
    expect(
      excelArtifactProtocolPrompt({
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
    ).toContain('<orca_excel_artifact>')
    expect(formatExcelArtifactResult({ state: 'completed', committed: true })).toBe(
      '<orca_excel_artifact_result>{"state":"completed","committed":true}</orca_excel_artifact_result>'
    )
  })
})
