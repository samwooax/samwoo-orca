import type { HermesTeamChatResult } from '../../shared/hermes-team-chat-result'
import type { TeamChatRunController } from './hermes-team-chat-run-controller'

export function teamChatCancellationResult(
  reason: TeamChatRunController['cancelledReason']
): HermesTeamChatResult | null {
  if (!reason) {
    return null
  }
  return {
    ok: false,
    error: reason === 'timeout' ? 'timeout waiting for team agent reply' : 'cancelled'
  }
}
