import {
  resolveTeamChatEffort,
  resolveTeamChatModel,
  type TeamChatEffort,
  type TeamChatHistoryMessage,
  type TeamChatModelId
} from '../../../../shared/hermes-team-chat-models'
import type { HermesTeamChatRoute } from './hermes-team-chat-route'
import { hermesTeamChatStorageKey } from './hermes-team-chat-storage-key'

export type StoredTeamChat = {
  messages: TeamChatHistoryMessage[]
  model: TeamChatModelId
  effort: TeamChatEffort
  conversationId: string
}

export function readStoredTeamChat(route: HermesTeamChatRoute, tabId: string): StoredTeamChat {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(hermesTeamChatStorageKey(route, tabId)) ?? ''
    ) as Partial<StoredTeamChat>
    const model = resolveTeamChatModel(parsed.model).id
    return {
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.filter(
            (message): message is TeamChatHistoryMessage =>
              (message?.role === 'user' || message?.role === 'assistant') &&
              typeof message.content === 'string'
          )
        : [],
      model,
      effort: resolveTeamChatEffort(model, parsed.effort),
      conversationId:
        typeof parsed.conversationId === 'string' && parsed.conversationId
          ? parsed.conversationId
          : crypto.randomUUID()
    }
  } catch {
    return {
      messages: [],
      model: 'gpt-5.5',
      effort: 'medium',
      conversationId: crypto.randomUUID()
    }
  }
}
