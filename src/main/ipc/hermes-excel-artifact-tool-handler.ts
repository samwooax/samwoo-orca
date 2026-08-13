import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import type {
  ExcelArtifactCapability,
  ExcelArtifactRequest,
  ExcelArtifactResult
} from '../../shared/hermes-excel-artifact'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { TeamChatLocalToolExecution } from '../../shared/hermes-team-chat-result'
import type { Store } from '../persistence'
import { resolveAuthorizedPath } from './filesystem-auth'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import { prepareExcelArtifactInputs } from './hermes-excel-artifact-inputs'
import { runDurableExcelArtifactJob } from './hermes-excel-artifact-job-registry'
import {
  createPrivateExcelWorkspace,
  isInsideExcelWorkspace,
  savePrivateExcelOutput
} from './hermes-excel-artifact-output'
import { formatExcelArtifactResult } from './hermes-excel-artifact-protocol'
import { runExcelArtifactWorker } from './hermes-excel-artifact-worker-client'
import type { LocalDocumentAttachment } from './hermes-local-document-protocol'

function artifactProgress(
  requestId: string,
  request: ExcelArtifactRequest,
  status: TeamChatProgressEvent['status'],
  detail?: string
): TeamChatProgressEvent {
  return {
    requestId,
    id: `excel-artifact-${request.operationId}`,
    kind: 'local_document',
    title: `Excel ${request.action}`,
    ...(detail ? { detail: detail.slice(0, 240) } : {}),
    status
  }
}

function failedResult(
  request: ExcelArtifactRequest,
  code: string,
  message: string
): ExcelArtifactResult {
  const now = new Date().toISOString()
  return {
    version: 1,
    operationId: request.operationId,
    idempotencyKey: request.idempotencyKey,
    jobId: `excel_${randomUUID()}`,
    action: request.action,
    state: 'failed',
    error: { code, message, recovery: 'Correct the request and retry.', details: {} },
    committed: false,
    cleanup: { status: 'removed', warnings: [] },
    startedAt: now,
    completedAt: now
  }
}

async function localWorkspaceRoot(cwd: string, store: Store): Promise<string | null> {
  if (!cwd.trim()) {
    return null
  }
  const root = await resolveAuthorizedPath(cwd, store)
  if (!(await lstat(root)).isDirectory()) {
    throw new Error('selected project root is not a local directory')
  }
  return root
}

function summarizeExecution(
  request: ExcelArtifactRequest,
  result: ExcelArtifactResult
): Omit<TeamChatLocalToolExecution, 'sequence'> {
  return {
    kind: 'excel_artifact',
    operations: [
      {
        id: request.operationId,
        kind: request.action,
        ok: result.state === 'completed',
        ...(result.output?.path ? { target: result.output.path } : {}),
        ...(result.output?.sha256 ? { sha256: result.output.sha256 } : {}),
        ...(result.error?.message ? { error: result.error.message } : {})
      }
    ]
  }
}

async function runExcelRequest(args: {
  cwd: string
  request: ExcelArtifactRequest
  store: Store
  artifactStore: HermesBinaryArtifactStore
  conversationId: string
  requestId: string
  attachments?: LocalDocumentAttachment[]
}): Promise<ExcelArtifactResult> {
  const selectedRoot = await localWorkspaceRoot(args.cwd, args.store)
  const privateRoot = selectedRoot ? null : await createPrivateExcelWorkspace()
  try {
    const root = selectedRoot ?? privateRoot!
    const prepared = await prepareExcelArtifactInputs(args)
    const receiptRoot = join(app.getPath('userData'), 'hermes-excel-artifact-jobs', 'receipts')
    await mkdir(receiptRoot, { recursive: true, mode: 0o700 })
    const outputKey = prepared.request.output?.path
      ? resolve(root, prepared.request.output.path)
      : undefined
    if (outputKey && !isInsideExcelWorkspace(root, outputKey)) {
      throw new Error('Excel output escapes the authorized workspace')
    }
    return await runDurableExcelArtifactJob({
      receiptRoot,
      scope: `${args.conversationId}\0${selectedRoot ?? '@attachments'}`,
      outputKey,
      request: prepared.request,
      run: async (jobId) => {
        const result = await runExcelArtifactWorker({
          requestId: args.requestId,
          jobId,
          workspace: root,
          request: prepared.request,
          artifacts: prepared.artifacts
        })
        if (!privateRoot || result.state !== 'completed' || !result.committed || !result.output) {
          return result
        }
        const source = resolve(privateRoot, result.output.path)
        if (!isInsideExcelWorkspace(privateRoot, source) || !(await lstat(source)).isFile()) {
          throw new Error('Excel worker output is unavailable')
        }
        return {
          ...result,
          output: {
            ...result.output,
            path: await savePrivateExcelOutput(source, result.output.path)
          }
        }
      }
    })
  } finally {
    if (privateRoot) {
      await rm(privateRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export async function executeExcelArtifactToolRequest(args: {
  cwd: string
  request: ExcelArtifactRequest
  capability: ExcelArtifactCapability
  store: Store
  artifactStore: HermesBinaryArtifactStore
  conversationId: string
  requestId: string
  attachments?: LocalDocumentAttachment[]
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<{ reply: string; execution: Omit<TeamChatLocalToolExecution, 'sequence'> }> {
  args.onProgress?.(artifactProgress(args.requestId, args.request, 'in_progress'))
  let result: ExcelArtifactResult
  try {
    if (!args.capability.actions.includes(args.request.action)) {
      throw new Error(`Excel Artifact action is unavailable: ${args.request.action}`)
    }
    result = await runExcelRequest(args)
  } catch (error) {
    result = failedResult(
      args.request,
      'generation_failed',
      error instanceof Error ? error.message : String(error)
    )
  }
  args.onProgress?.(
    artifactProgress(
      args.requestId,
      args.request,
      result.state === 'completed' ? 'completed' : 'failed',
      result.output?.path ?? result.error?.message
    )
  )
  return {
    reply: formatExcelArtifactResult(result),
    execution: summarizeExecution(args.request, result)
  }
}
