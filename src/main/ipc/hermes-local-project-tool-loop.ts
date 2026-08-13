import type { Store } from '../persistence'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { ExcelArtifactCapability } from '../../shared/hermes-excel-artifact'
import { localCommandProgress } from './hermes-local-command-progress'
import {
  formatLocalCommandResults,
  LOCAL_PROJECT_COMMAND_PROTOCOL_PROMPT,
  parseLocalCommandRequest
} from './hermes-local-command-protocol'
import { localFileProgress } from './hermes-local-file-progress'
import {
  formatLocalFileResults,
  LOCAL_PROJECT_FILE_PROTOCOL_PROMPT,
  parseLocalFileRequest
} from './hermes-local-file-protocol'
import {
  LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT,
  parseLocalDocumentRequest,
  type LocalDocumentAttachment
} from './hermes-local-document-protocol'
import { executeLocalDocumentToolRequest } from './hermes-local-document-tool-handler'
import {
  excelArtifactProtocolPrompt,
  parseExcelArtifactRequest
} from './hermes-excel-artifact-protocol'
import { executeExcelArtifactToolRequest } from './hermes-excel-artifact-tool-handler'
import { executeLocalCommandRequest } from './hermes-local-project-commands'
import { executeLocalFileRequest } from './hermes-local-project-files'
import { approveLocalCommandRequest } from './hermes-local-command-approval'
import type {
  TeamChatLocalToolExecution,
  TeamChatLocalToolOperationResult
} from '../../shared/hermes-team-chat-result'

export function localProjectToolProtocolPrompt(
  excelCapability: ExcelArtifactCapability | null
): string {
  return `${LOCAL_PROJECT_FILE_PROTOCOL_PROMPT}\n${LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT}\n${LOCAL_PROJECT_COMMAND_PROTOCOL_PROMPT}\n${excelArtifactProtocolPrompt(excelCapability)}`
}

export type LocalProjectToolReply =
  | { kind: 'none' }
  | { kind: 'invalid'; error: string }
  | { kind: 'blocked' }
  | {
      kind: 'executed'
      reply: string
      execution: Omit<TeamChatLocalToolExecution, 'sequence'>
    }

function hasEnvelopeMarker(reply: string, name: 'files' | 'documents' | 'commands'): boolean {
  return reply.includes(`<orca_local_${name}>`) || reply.includes(`</orca_local_${name}>`)
}

function hasUnknownOrcaEnvelope(reply: string): boolean {
  return /<\/?orca_[A-Za-z0-9_]+>/.test(reply)
}

function hasExcelEnvelope(reply: string): boolean {
  return reply.includes('<orca_excel_artifact>') || reply.includes('</orca_excel_artifact>')
}

function summarizeFileResults(
  request: NonNullable<ReturnType<typeof parseLocalFileRequest>>,
  results: Awaited<ReturnType<typeof executeLocalFileRequest>>
): TeamChatLocalToolOperationResult[] {
  const operations = new Map(request.operations.map((operation) => [operation.id, operation]))
  return results.map((result) => {
    const operation = operations.get(result.id)
    return {
      id: result.id,
      kind: operation?.kind ?? 'read',
      ok: result.ok,
      ...(operation ? { target: operation.path } : {}),
      ...(result.sha256 ? { sha256: result.sha256 } : {}),
      ...(result.error ? { error: result.error } : {})
    }
  })
}

function summarizeCommandResults(
  request: NonNullable<ReturnType<typeof parseLocalCommandRequest>>,
  results: Awaited<ReturnType<typeof executeLocalCommandRequest>>
): TeamChatLocalToolOperationResult[] {
  const operations = new Map(request.operations.map((operation) => [operation.id, operation]))
  return results.map((result) => {
    const operation = operations.get(result.id)
    const target = operation?.kind === 'run' ? operation.command : operation?.processId
    return {
      id: result.id,
      kind: operation?.kind ?? 'run',
      ok: result.ok,
      ...(target ? { target } : {}),
      ...(result.status ? { status: result.status } : {}),
      ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      ...(result.processId ? { processId: result.processId } : {}),
      ...(result.url ? { url: result.url } : {}),
      ...(result.error ? { error: result.error } : {})
    }
  })
}

export async function executeLocalProjectToolReply(args: {
  reply: string
  cwd: string
  store: Store
  artifactStore?: HermesBinaryArtifactStore
  excelCapability?: ExcelArtifactCapability | null
  conversationId?: string
  requestId: string
  documentAttachments?: LocalDocumentAttachment[]
  allowExecution?: boolean
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<LocalProjectToolReply> {
  const fileRequest = parseLocalFileRequest(args.reply)
  const documentRequest = parseLocalDocumentRequest(args.reply)
  const commandRequest = parseLocalCommandRequest(args.reply)
  const excelRequest = parseExcelArtifactRequest(args.reply)
  const hasFileEnvelope = hasEnvelopeMarker(args.reply, 'files')
  const hasDocumentEnvelope = hasEnvelopeMarker(args.reply, 'documents')
  const hasCommandEnvelope = hasEnvelopeMarker(args.reply, 'commands')
  const hasExcelArtifactEnvelope = hasExcelEnvelope(args.reply)
  if (
    [hasFileEnvelope, hasDocumentEnvelope, hasCommandEnvelope, hasExcelArtifactEnvelope].filter(
      Boolean
    ).length > 1
  ) {
    return {
      kind: 'invalid',
      error: 'local tool reply must contain exactly one file, document, command, or Excel envelope'
    }
  }
  if (!fileRequest && !documentRequest && !commandRequest && !excelRequest) {
    if (
      hasFileEnvelope ||
      hasDocumentEnvelope ||
      hasCommandEnvelope ||
      hasExcelArtifactEnvelope ||
      hasUnknownOrcaEnvelope(args.reply)
    ) {
      return {
        kind: 'invalid',
        error: hasExcelArtifactEnvelope
          ? 'invalid or unsupported Excel Artifact envelope'
          : hasCommandEnvelope
            ? 'invalid local command envelope; use mode and timeoutSeconds fields'
            : hasDocumentEnvelope
              ? 'invalid local document envelope; use one exact version 1 envelope'
              : hasFileEnvelope
                ? 'invalid local file envelope; use one exact version 1 envelope'
                : 'invalid or unsupported local tool envelope'
      }
    }
    return { kind: 'none' }
  }
  if (args.allowExecution === false) {
    return { kind: 'blocked' }
  }
  if (excelRequest) {
    if (!args.excelCapability || !args.artifactStore || !args.conversationId) {
      return { kind: 'invalid', error: 'Excel Artifact capability is unavailable' }
    }
    return {
      kind: 'executed',
      ...(await executeExcelArtifactToolRequest({
        cwd: args.cwd,
        request: excelRequest,
        capability: args.excelCapability,
        store: args.store,
        artifactStore: args.artifactStore,
        conversationId: args.conversationId,
        requestId: args.requestId,
        attachments: args.documentAttachments,
        onProgress: args.onProgress
      }))
    }
  }
  if (documentRequest) {
    return {
      kind: 'executed',
      ...(await executeLocalDocumentToolRequest({
        cwd: args.cwd,
        request: documentRequest,
        store: args.store,
        artifactStore: args.artifactStore,
        conversationId: args.conversationId,
        requestId: args.requestId,
        attachments: args.documentAttachments,
        onProgress: args.onProgress
      }))
    }
  }
  // Why: without a selected project root every local operation fails anyway, so
  // approving one first is a prompt the user can only answer one way. It also
  // keeps an unattended turn (a scheduled prompt) from raising a modal dialog
  // nobody is there to dismiss. The bot still learns the operation was refused.
  if (!args.cwd.trim()) {
    const reason = 'no local project is selected'
    if (fileRequest) {
      const results = fileRequest.operations.map((operation) => ({
        id: operation.id,
        ok: false,
        path: operation.path,
        error: reason
      }))
      return {
        kind: 'executed',
        reply: formatLocalFileResults(results),
        execution: { kind: 'local_file', operations: summarizeFileResults(fileRequest, results) }
      }
    }
    const results = commandRequest!.operations.map((operation) => ({
      id: operation.id,
      ok: false,
      error: reason
    }))
    return {
      kind: 'executed',
      reply: formatLocalCommandResults(results),
      execution: {
        kind: 'local_command',
        operations: summarizeCommandResults(commandRequest!, results)
      }
    }
  }
  if (fileRequest) {
    let results: Awaited<ReturnType<typeof executeLocalFileRequest>>
    try {
      results = await executeLocalFileRequest({
        cwd: args.cwd,
        request: fileRequest,
        store: args.store,
        onOperationStart: (operation) => {
          args.onProgress?.(localFileProgress(args.requestId, operation, 'in_progress'))
        },
        onOperationComplete: (operation, result) => {
          args.onProgress?.(
            localFileProgress(
              args.requestId,
              operation,
              result.ok ? 'completed' : 'failed',
              result.error
            )
          )
        }
      })
    } catch (error) {
      results = fileRequest.operations.map((operation) => ({
        id: operation.id,
        ok: false,
        path: operation.path,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
    return {
      kind: 'executed',
      reply: formatLocalFileResults(results),
      execution: { kind: 'local_file', operations: summarizeFileResults(fileRequest, results) }
    }
  }
  if (!(await approveLocalCommandRequest(commandRequest!))) {
    const results = commandRequest!.operations.map((operation) => ({
      id: operation.id,
      ok: false,
      error: 'user denied local command execution'
    }))
    return {
      kind: 'executed',
      reply: formatLocalCommandResults(results),
      execution: {
        kind: 'local_command',
        operations: summarizeCommandResults(commandRequest!, results)
      }
    }
  }
  let results: Awaited<ReturnType<typeof executeLocalCommandRequest>>
  try {
    results = await executeLocalCommandRequest({
      cwd: args.cwd,
      request: commandRequest!,
      store: args.store,
      onOperationStart: (operation) => {
        args.onProgress?.(localCommandProgress(args.requestId, operation, 'in_progress'))
      },
      onOperationComplete: (operation, result) => {
        args.onProgress?.(
          localCommandProgress(
            args.requestId,
            operation,
            result.ok ? 'completed' : 'failed',
            result.error ?? result.url
          )
        )
      }
    })
  } catch (error) {
    results = commandRequest!.operations.map((operation) => ({
      id: operation.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }))
  }
  return {
    kind: 'executed',
    reply: formatLocalCommandResults(results),
    execution: {
      kind: 'local_command',
      operations: summarizeCommandResults(commandRequest!, results)
    }
  }
}
