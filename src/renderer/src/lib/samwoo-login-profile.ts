type SamwooLoginProfileFields = {
  profile?: string | null
  role?: string | null
}

function normalizedProfile(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function resolveSamwooLoginProfile(result: SamwooLoginProfileFields): string | null {
  // Why: the auth service's explicit profile is authoritative; role is retained for older responses.
  return normalizedProfile(result.profile) ?? normalizedProfile(result.role)
}
