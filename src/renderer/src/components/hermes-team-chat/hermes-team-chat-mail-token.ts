export function resolveHermesTeamChatMailToken(
  currentToken: string | undefined,
  routeToken: string
): string {
  return currentToken || routeToken
}
