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

export const LOCAL_PROJECT_TOOL_PROTOCOL_PROMPT = `${LOCAL_PROJECT_FILE_PROTOCOL_PROMPT}\n${LOCAL_PROJECT_COMMAND_PROTOCOL_PROMPT}`

export async function executeLocalProjectToolReply(args: {
  reply: string
  cwd: string
  store: Store
  requestId: string
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<string | null> {
  const fileRequest = parseLocalFileRequest(args.reply)
  const commandRequest = parseLocalCommandRequest(args.reply)
  if (!fileRequest && !commandRequest) {
    return null
  }
  if (fileRequest) {
    return executeLocalFileRequest({
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
      .then(formatLocalFileResults)
      .catch((error: unknown) =>
        formatLocalFileResults(
          fileRequest.operations.map((operation) => ({
            id: operation.id,
            ok: false,
            path: operation.path,
            error: error instanceof Error ? error.message : String(error)
          }))
        )
      )
  }
  return executeLocalCommandRequest({
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
    .then(formatLocalCommandResults)
    .catch((error: unknown) =>
      formatLocalCommandResults(
        commandRequest!.operations.map((operation) => ({
          id: operation.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }))
      )
    )
}
