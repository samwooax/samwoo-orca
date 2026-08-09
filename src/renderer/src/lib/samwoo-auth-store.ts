import { create } from 'zustand'
import { canonicalSamwooLogin } from '../../../shared/samwoo-login-identity'
import { hasValidSamwooSession } from './samwoo-session-validation'

/** SAMWOO-ORCA: the signed-in employee's identity + mapped team-bot role.
 *  Persisted to localStorage so the session survives app restarts until an
 *  explicit logout. No password is ever stored. */
export type SamwooAuth = {
  login: string
  name: string
  role: string | null
  label: string | null
  /** SAMWOO-ORCA: opaque session handle from the auth service. Maps to the
   *  server-held mail credentials (never the password itself) so the team-bot
   *  can read/send this user's mail during the session. */
  token: string
}

type SamwooAuthState = {
  auth: SamwooAuth | null
  setAuth: (auth: SamwooAuth) => void
  logout: () => Promise<void>
}

const STORAGE_KEY = 'samwoo.auth'

function canonicalAuth(auth: SamwooAuth): SamwooAuth | null {
  const login = canonicalSamwooLogin(auth.login)
  return login ? { ...auth, login } : null
}

function load(): SamwooAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<SamwooAuth>
    if (hasValidSamwooSession(parsed)) {
      const auth = canonicalAuth(parsed)
      if (auth) {
        if (auth.login !== parsed.login) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
          } catch {
            // best-effort persistence
          }
        }
        return auth
      }
    }
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore malformed persisted state
  }
  return null
}

export const useSamwooAuthStore = create<SamwooAuthState>((set) => ({
  auth: load(),
  setAuth: (auth) => {
    const normalized = canonicalAuth(auth)
    if (!normalized) {
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // best-effort persistence
    }
    set({ auth: normalized })
  },
  logout: async () => {
    const token = useSamwooAuthStore.getState().auth?.token
    // Why: network loss must not trap the user in a locally expired session.
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    set({ auth: null })
    if (token) {
      await window.api.preflight.samwooWorkspaceShares.revokeSession(token)
    }
  }
}))

if (typeof window !== 'undefined') {
  // Why: the main and messenger renderers share authentication through their common session.
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      useSamwooAuthStore.setState({ auth: load() })
    }
  })
}

/** Non-hook accessor for use inside worktree activation logic. */
export function getSamwooAuth(): SamwooAuth | null {
  return useSamwooAuthStore.getState().auth
}
