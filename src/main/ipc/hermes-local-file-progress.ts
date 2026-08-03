import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { LocalFileOperation } from './hermes-local-file-protocol'

export function localFileProgress(
  requestId: string,
  operation: LocalFileOperation,
  status: TeamChatProgressEvent['status'],
  error?: string
): TeamChatProgressEvent {
  const action =
    operation.kind === 'list' ? '폴더 확인' : operation.kind === 'read' ? '파일 읽기' : '파일 수정'
  return {
    requestId,
    id: `local-${operation.id}`,
    kind: 'local_file',
    title: `${action}: ${operation.path}`,
    ...(error ? { detail: error.slice(0, 240) } : {}),
    status
  }
}
