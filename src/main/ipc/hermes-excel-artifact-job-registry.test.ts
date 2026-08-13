import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExcelArtifactRequest } from '../../shared/hermes-excel-artifact'
import { runDurableExcelArtifactJob } from './hermes-excel-artifact-job-registry'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function request(path = 'report.xlsx'): ExcelArtifactRequest {
  return {
    version: 1,
    operationId: 'operation-001',
    idempotencyKey: 'idempotency-key-0001',
    action: 'create',
    output: { path, overwrite: false },
    workbookSpec: { version: 1 },
    validation: { openXml: true, formulas: true, charts: true, renderPreview: false },
    toolchain: { profile: 'excel-artifact-v1', version: '1' },
    timeoutSeconds: 60
  }
}

describe('durable Excel Artifact jobs', () => {
  it('replays a terminal receipt without running a second mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-excel-receipt-'))
    roots.push(root)
    const run = vi.fn(async (jobId: string) => ({
      version: 1,
      jobId,
      state: 'completed' as const,
      committed: true
    }))
    const args = { receiptRoot: root, scope: 'conversation', request: request(), run }

    const first = await runDurableExcelArtifactJob(args)
    const second = await runDurableExcelArtifactJob(args)

    expect(first).toEqual(second)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of an idempotency key with a changed request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-excel-receipt-'))
    roots.push(root)
    const run = vi.fn(async (jobId: string) => ({ jobId, state: 'completed' as const }))
    await runDurableExcelArtifactJob({
      receiptRoot: root,
      scope: 'conversation',
      request: request(),
      run
    })
    const conflict = await runDurableExcelArtifactJob({
      receiptRoot: root,
      scope: 'conversation',
      request: request('different.xlsx'),
      run
    })

    expect(conflict.error?.code).toBe('job_conflict')
    expect(run).toHaveBeenCalledTimes(1)
  })
})
