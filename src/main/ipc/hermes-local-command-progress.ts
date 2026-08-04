import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { LocalCommandOperation } from './hermes-local-command-protocol'

export function localCommandProgress(
  requestId: string,
  operation: LocalCommandOperation,
  status: TeamChatProgressEvent['status'],
  detail?: string
): TeamChatProgressEvent {
  const title =
    operation.kind === 'stop'
      ? `프로세스 중지: ${operation.processId}`
      : `프로젝트 실행: ${operation.command} ${operation.args.join(' ')}`
  return {
    requestId,
    id: `local-command-${operation.id}`,
    kind: 'local_command',
    title,
    ...(detail ? { detail: detail.slice(0, 240) } : {}),
    status
  }
}
