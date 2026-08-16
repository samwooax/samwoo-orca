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

  it('repairs one unambiguous spurious brace but keeps the 1MiB gate and refuses ambiguity', () => {
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
    const brokenInsideArray = `<orca_excel_artifact>${JSON.stringify(request).replace(
      '"state":"visible"}',
      '"state":"visible"}}'
    )}</orca_excel_artifact>`
    expect(parseExcelArtifactRequest(brokenInsideArray)).toEqual(request)

    // A trailing brace after a flat top-level object admits two single-deletion
    // readings (drop the tail vs. re-parent trailing keys), so it fails closed.
    expect(
      parseExcelArtifactRequest(`<orca_excel_artifact>${JSON.stringify(request)}}</orca_excel_artifact>`)
    ).toBeNull()

    const oversized = {
      ...request,
      workbookSpec: {
        version: 1,
        sheets: [
          {
            name: 'Summary',
            state: 'visible',
            cells: [{ address: 'A1', value: 'x'.repeat(1024 * 1024) }]
          }
        ]
      }
    }
    // The byte gate runs on the raw reply before any repair is attempted.
    expect(
      parseExcelArtifactRequest(
        `<orca_excel_artifact>${JSON.stringify(oversized).replace(
          '"state":"visible"',
          '"state":"visible"}'
        )}</orca_excel_artifact>`
      )
    ).toBeNull()
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

  it('normalizes observed chart aliases into the canonical v1 chart shape', () => {
    // Shape of production message 4915: chartType, shared top-level categories,
    // and series given as bare {sheet, range}.
    const request = {
      version: 1,
      operationId: 'operation-chart-001',
      idempotencyKey: 'idempotency-chart-0001',
      action: 'create',
      output: { path: 'reports/dashboard.xlsx' },
      workbookSpec: {
        version: 1,
        sheets: [
          {
            name: 'Dashboard',
            state: 'visible',
            charts: [
              {
                chartType: 'bar',
                title: '국가별 인구 증감',
                categories: { sheet: 'Country_Data', range: 'B2:B6' },
                series: [{ name: '증감', sheet: 'Country_Data', range: 'D2:D6' }],
                position: 'F2'
              }
            ]
          }
        ]
      },
      toolchain: { profile: 'excel-artifact-v1', version: '1' },
      timeoutSeconds: 60
    }
    const envelope = `<orca_excel_artifact>${JSON.stringify(request)}</orca_excel_artifact>`

    expect(parseExcelArtifactRequest(envelope)?.workbookSpec).toMatchObject({
      sheets: [
        {
          charts: [
            {
              type: 'bar',
              title: '국가별 인구 증감',
              series: [
                {
                  name: '증감',
                  categories: { sheet: 'Country_Data', range: 'B2:B6' },
                  values: { sheet: 'Country_Data', range: 'D2:D6' }
                }
              ],
              position: 'F2'
            }
          ]
        }
      ]
    })
    const parsed = parseExcelArtifactRequest(envelope)
    expect(parsed).not.toBeNull()
    const normalizedChart = (
      parsed!.workbookSpec as { sheets: { charts: Record<string, unknown>[] }[] }
    ).sheets[0].charts[0]
    expect('chartType' in normalizedChart).toBe(false)
    expect('categories' in normalizedChart).toBe(false)

    // A series that already carries canonical values keeps its extra alias
    // fields for strict worker rejection instead of silent dropping.
    const conflicting = request.workbookSpec.sheets[0].charts[0]
    const conflictEnvelope = `<orca_excel_artifact>${JSON.stringify({
      ...request,
      workbookSpec: {
        version: 1,
        sheets: [
          {
            name: 'Dashboard',
            state: 'visible',
            charts: [
              {
                ...conflicting,
                series: [
                  { sheet: 'Country_Data', range: 'D2:D6', values: { sheet: 'Other', range: 'A1:A2' } }
                ]
              }
            ]
          }
        ]
      }
    })}</orca_excel_artifact>`
    expect(parseExcelArtifactRequest(conflictEnvelope)?.workbookSpec).toMatchObject({
      sheets: [
        {
          charts: [
            {
              series: [
                { sheet: 'Country_Data', range: 'D2:D6', values: { sheet: 'Other', range: 'A1:A2' } }
              ]
            }
          ]
        }
      ]
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
    expect(prompt).toContain('"position":"F2"')
    expect(prompt).toContain('area|bar|column|doughnut|line|pie|scatter')
    expect(prompt).toContain('x/y inch 좌표나 chartType')
    expect(prompt).toContain('존재하지 않는 시트를 참조하면 검증이 실패합니다')
    expect(formatExcelArtifactResult({ state: 'completed', committed: true })).toBe(
      '<orca_excel_artifact_result>{"state":"completed","committed":true}</orca_excel_artifact_result>'
    )
  })
})
