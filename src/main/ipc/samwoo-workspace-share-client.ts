import { SAMWOO_AUTH_SERVICE_URL } from '../../shared/samwoo-service-endpoints'
import type { SamwooWorkspaceShareResult } from '../../shared/samwoo-workspace-sharing'
import { postSamwooServiceJson } from './samwoo-service-http-client'

export const SAMWOO_AUTH_URL = SAMWOO_AUTH_SERVICE_URL

const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024
const RETRYABLE_ROUTES = new Set([
  '/workspace-shares/list',
  '/workspace-shares/comments/list',
  '/workspace-shares/files/list',
  '/workspace-shares/files/read',
  '/profile-messages/channels/list',
  '/profile-messages/list',
  '/profile-messages/read'
])

export function postSamwooWorkspaceShare<
  Result extends { ok: boolean; error?: string } = SamwooWorkspaceShareResult
>(
  route: string,
  token: string,
  body: Record<string, unknown> = {},
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<Result> {
  return postSamwooServiceJson({
    baseUrl: SAMWOO_AUTH_URL,
    route,
    token,
    body,
    timeoutMs: route === '/workspace-shares/files/write' ? 5 * 60_000 : 60_000,
    timeoutError: 'workspace share server timed out',
    invalidUrlError: 'invalid workspace share server url',
    maxResponseBytes,
    responseTooLargeError: 'workspace share response is too large',
    retryTransient: RETRYABLE_ROUTES.has(route)
  })
}
