import { createHash, randomUUID } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExcelArtifactRequest, ExcelArtifactResult } from '../../shared/hermes-excel-artifact'

type Receipt = {
  fingerprint: string
  state: 'running' | 'terminal'
  jobId: string
  updatedAt: string
  result?: ExcelArtifactResult
}

const activeJobs = new Map<string, Promise<ExcelArtifactResult>>()
const outputLocks = new Map<string, string>()

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function requestFingerprint(request: ExcelArtifactRequest): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex')
}

function receiptPath(root: string, scope: string, idempotencyKey: string): string {
  const name = createHash('sha256').update(`${scope}\0${idempotencyKey}`).digest('hex')
  return join(root, `${name}.jsonl`)
}

async function lastReceipt(path: string): Promise<Receipt | null> {
  try {
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    return JSON.parse(lines.at(-1) ?? '') as Receipt
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw new Error('Excel Artifact receipt is unreadable')
  }
}

async function appendReceipt(path: string, receipt: Receipt): Promise<void> {
  const handle = await open(path, 'a', 0o600)
  try {
    await handle.write(`${JSON.stringify(receipt)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function failure(
  request: ExcelArtifactRequest,
  jobId: string,
  code: string,
  message: string,
  recovery: string,
  state: 'failed' | 'cancelled' = 'failed'
): ExcelArtifactResult {
  return {
    version: 1,
    operationId: request.operationId,
    idempotencyKey: request.idempotencyKey,
    jobId,
    action: request.action,
    state,
    error: { code, message, recovery, details: {} },
    committed: false,
    cleanup: { status: 'removed', warnings: [] },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  }
}

export async function runDurableExcelArtifactJob(args: {
  receiptRoot: string
  scope: string
  outputKey?: string
  request: ExcelArtifactRequest
  run: (jobId: string) => Promise<ExcelArtifactResult>
}): Promise<ExcelArtifactResult> {
  const key = `${args.scope}\0${args.request.idempotencyKey}`
  const active = activeJobs.get(key)
  if (active) {
    return active
  }
  const task = (async () => {
    const fingerprint = requestFingerprint(args.request)
    const path = receiptPath(args.receiptRoot, args.scope, args.request.idempotencyKey)
    const existing = await lastReceipt(path)
    if (existing?.fingerprint !== undefined && existing.fingerprint !== fingerprint) {
      return failure(
        args.request,
        existing.jobId,
        'job_conflict',
        'The idempotency key belongs to a different request.',
        'Use a new idempotency key for a new operation.'
      )
    }
    if (existing?.state === 'terminal' && existing.result) {
      return existing.result
    }
    if (existing?.state === 'running') {
      return failure(
        args.request,
        existing.jobId,
        'job_result_unknown',
        'A previous run ended before its result was recorded.',
        'Inspect the output before submitting a new operation.'
      )
    }
    const jobId = `excel_${randomUUID()}`
    if (args.outputKey && outputLocks.has(args.outputKey)) {
      return failure(
        args.request,
        jobId,
        'job_conflict',
        'Another artifact job owns the requested output.',
        'Wait for the active job to finish.'
      )
    }
    await appendReceipt(path, {
      fingerprint,
      state: 'running',
      jobId,
      updatedAt: new Date().toISOString()
    })
    if (args.outputKey) {
      outputLocks.set(args.outputKey, jobId)
    }
    let result: ExcelArtifactResult
    try {
      result = await args.run(jobId)
    } catch (error) {
      const cancelled = error instanceof Error && error.message.includes('cancelled')
      result = failure(
        args.request,
        jobId,
        cancelled ? 'cancelled' : 'generation_failed',
        cancelled ? 'The Excel Artifact job was cancelled.' : 'The Excel Artifact worker failed.',
        'Retry with a supported workbook request.',
        cancelled ? 'cancelled' : 'failed'
      )
    } finally {
      if (args.outputKey && outputLocks.get(args.outputKey) === jobId) {
        outputLocks.delete(args.outputKey)
      }
    }
    await appendReceipt(path, {
      fingerprint,
      state: 'terminal',
      jobId,
      result,
      updatedAt: new Date().toISOString()
    })
    return result
  })()
  activeJobs.set(key, task)
  try {
    return await task
  } finally {
    if (activeJobs.get(key) === task) {
      activeJobs.delete(key)
    }
  }
}
