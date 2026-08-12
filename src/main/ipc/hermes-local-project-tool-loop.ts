import type { Store } from '../persistence'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
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
import { executeLocalCommandRequest } from './hermes-local-project-commands'
import { executeLocalFileRequest } from './hermes-local-project-files'
import { approveLocalCommandRequest } from './hermes-local-command-approval'
import type {
  TeamChatLocalToolExecution,
  TeamChatLocalToolOperationResult
} from '../../shared/hermes-team-chat-result'

export const LOCAL_PROJECT_TOOL_PROTOCOL_PROMPT = `${LOCAL_PROJECT_FILE_PROTOCOL_PROMPT}\n${LOCAL_PROJECT_COMMAND_PROTOCOL_PROMPT}`

export type LocalProjectToolReply =
  | { kind: 'none' }
  | { kind: 'invalid'; error: string }
  | { kind: 'blocked' }
  | {
      kind: 'executed'
      reply: string
      execution: Omit<TeamChatLocalToolExecution, 'sequence'>
    }

function hasEnvelopeMarker(reply: string, name: 'files' | 'commands'): boolean {
  return reply.includes(`<orca_local_${name}>`) || reply.includes(`</orca_local_${name}>`)
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
  requestId: string
  allowExecution?: boolean
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<LocalProjectToolReply> {
  const fileRequest = parseLocalFileRequest(args.reply)
  const commandRequest = parseLocalCommandRequest(args.reply)
  const hasFileEnvelope = hasEnvelopeMarker(args.reply, 'files')
  const hasCommandEnvelope = hasEnvelopeMarker(args.reply, 'commands')
  if (hasFileEnvelope && hasCommandEnvelope) {
    return {
      kind: 'invalid',
      error: 'local tool reply must contain exactly one file or command envelope'
    }
  }
  if (!fileRequest && !commandRequest) {
    if (hasFileEnvelope || hasCommandEnvelope || args.reply.includes('<orca_local_')) {
      return {
        kind: 'invalid',
        error: hasCommandEnvelope
          ? 'invalid local command envelope; use mode and timeoutSeconds fields'
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
