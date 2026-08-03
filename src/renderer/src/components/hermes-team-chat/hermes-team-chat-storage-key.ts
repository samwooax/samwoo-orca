import type { HermesTeamChatRoute } from './hermes-team-chat-route'

export function hermesTeamChatStorageKey(route: HermesTeamChatRoute, tabId: string): string {
  return `samwoo-team-chat:v2:${tabId}:${route.profile}:${route.cwd}`
}
