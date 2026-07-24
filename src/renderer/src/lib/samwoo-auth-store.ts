import { create } from 'zustand'

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
  token?: string
}

type SamwooAuthState = {
  auth: SamwooAuth | null
  setAuth: (auth: SamwooAuth) => void
  logout: () => void
}

const STORAGE_KEY = 'samwoo.auth'

function load(): SamwooAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as SamwooAuth
    if (typeof parsed?.login === 'string') {
      return parsed
    }
  } catch {
    // ignore malformed persisted state
  }
  return null
}

export const useSamwooAuthStore = create<SamwooAuthState>((set) => ({
  auth: load(),
  setAuth: (auth) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
    } catch {
      // best-effort persistence
    }
    set({ auth })
  },
  logout: () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    set({ auth: null })
  }
}))

/** Non-hook accessor for use inside worktree activation logic. */
export function getSamwooAuth(): SamwooAuth | null {
  return useSamwooAuthStore.getState().auth
}
