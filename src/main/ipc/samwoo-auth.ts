import { ipcMain } from 'electron'
import { SAMWOO_AUTH_SERVICE_URL } from '../../shared/samwoo-service-endpoints'
import { postSamwooServiceJson } from './samwoo-service-http-client'

export type SamwooLoginResult = {
  ok: boolean
  login?: string
  role?: string | null
  profile?: string | null
  label?: string | null
  name?: string
  /** Session handle for mail access (maps to server-held credentials). */
  token?: string
  error?: string
}

function postLogin(login: string, password: string): Promise<SamwooLoginResult> {
  return postSamwooServiceJson({
    baseUrl: SAMWOO_AUTH_SERVICE_URL,
    route: '/login',
    body: { login, password },
    timeoutMs: 30_000,
    timeoutError: 'auth server timed out',
    invalidUrlError: 'invalid auth server url',
    maxResponseBytes: 64 * 1024,
    responseTooLargeError: 'auth server response is too large'
  })
}

/** SAMWOO-ORCA: verify a groupware login via the tailnet auth service and
 *  return the mapped team-bot role. The password is forwarded once and never
 *  persisted on this side. */
export function registerSamwooAuthHandlers(): void {
  ipcMain.handle(
    'samwoo:login',
    async (_event, args: { login?: string; password?: string }): Promise<SamwooLoginResult> => {
      const login = args?.login?.trim() ?? ''
      const password = args?.password ?? ''
      if (!login || !password) {
        return { ok: false, error: 'login and password required' }
      }
      return postLogin(login, password)
    }
  )
}
