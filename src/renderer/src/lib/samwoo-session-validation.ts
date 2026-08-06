import type { SamwooAuth } from './samwoo-auth-store'

const MIN_TOKEN_LENGTH = 20
const MAX_TOKEN_LENGTH = 256

export function isValidSamwooToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    token.length >= MIN_TOKEN_LENGTH &&
    token.length <= MAX_TOKEN_LENGTH
  )
}

export function hasValidSamwooSession(auth: Partial<SamwooAuth> | null): auth is SamwooAuth {
  return (
    typeof auth?.login === 'string' &&
    typeof auth.name === 'string' &&
    isValidSamwooToken(auth.token)
  )
}

export function isSamwooSessionError(error: string | undefined): boolean {
  const normalized = error?.trim().toLowerCase()
  return (
    normalized === 'login required' ||
    normalized === 'missing bearer token' ||
    normalized === 'invalid or expired session'
  )
}
