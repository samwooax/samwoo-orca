export type HermesTeamChatRoute = {
  profile: string
  label: string
  host: string
  cwd: string
  mailToken: string
}

const PROFILE_RE = /^[A-Za-z0-9._-]+$/
const HOST_RE = /^[A-Za-z0-9@.:_-]+$/

export function parseHermesTeamChatRoute(
  url: string | null | undefined
): HermesTeamChatRoute | null {
  if (!url) {
    return null
  }
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.pathname !== '/chat'
    ) {
      return null
    }
    const profile = parsed.searchParams.get('profile') ?? ''
    const host = parsed.searchParams.get('host') ?? ''
    if (!PROFILE_RE.test(profile) || !HOST_RE.test(host)) {
      return null
    }
    return {
      profile,
      label: parsed.searchParams.get('label')?.trim() || profile,
      host,
      cwd: parsed.searchParams.get('cwd') ?? '',
      mailToken: parsed.searchParams.get('mailtoken') ?? ''
    }
  } catch {
    return null
  }
}
