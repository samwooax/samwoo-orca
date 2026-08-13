import type { Store } from '../persistence'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type {
  TeamChatLocalToolExecution,
  TeamChatLocalToolOperationResult
} from '../../shared/hermes-team-chat-result'
import { localDocumentProgress } from './hermes-local-document-progress'
import {
  formatLocalDocumentResults,
  type LocalDocumentAttachment,
  type LocalDocumentRequest,
  type LocalDocumentResult
} from './hermes-local-document-protocol'
import { executeLocalDocumentRequest } from './hermes-local-project-documents'

function summarizeDocumentResults(
  request: LocalDocumentRequest,
  results: LocalDocumentResult[]
): TeamChatLocalToolOperationResult[] {
  const operations = new Map(request.operations.map((operation) => [operation.id, operation]))
  return results.map((result) => {
    const operation = operations.get(result.id)
    return {
      id: result.id,
      kind: operation?.kind ?? 'inspect',
      ok: result.ok,
      ...(operation
        ? {
            target: 'outputPath' in operation ? operation.outputPath : operation.path
          }
        : {}),
      ...(result.sha256 ? { sha256: result.sha256 } : {}),
      ...(result.error ? { error: result.error } : {})
    }
  })
}

export async function executeLocalDocumentToolRequest(args: {
  cwd: string
  request: LocalDocumentRequest
  store: Store
  artifactStore?: HermesBinaryArtifactStore
  conversationId?: string
  requestId: string
  attachments?: LocalDocumentAttachment[]
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<{
  reply: string
  execution: Omit<TeamChatLocalToolExecution, 'sequence'>
}> {
  let results: LocalDocumentResult[]
  try {
    results = await executeLocalDocumentRequest({
      cwd: args.cwd,
      request: args.request,
      store: args.store,
      artifactStore: args.artifactStore,
      conversationId: args.conversationId ?? '',
      requestId: args.requestId,
      attachments: args.attachments,
      onOperationStart: (operation) => {
        args.onProgress?.(localDocumentProgress(args.requestId, operation, 'in_progress'))
      },
      onOperationComplete: (operation, result) => {
        args.onProgress?.(
          localDocumentProgress(
            args.requestId,
            operation,
            result.ok ? 'completed' : 'failed',
            result.error ?? result.outputPath
          )
        )
      }
    })
  } catch (error) {
    results = args.request.operations.map((operation) => ({
      id: operation.id,
      ok: false,
      ...('path' in operation ? { path: operation.path } : {}),
      ...('outputPath' in operation ? { outputPath: operation.outputPath } : {}),
      error: error instanceof Error ? error.message : String(error)
    }))
  }
  return {
    reply: formatLocalDocumentResults(results),
    execution: {
      kind: 'local_document',
      operations: summarizeDocumentResults(args.request, results)
    }
  }
}
