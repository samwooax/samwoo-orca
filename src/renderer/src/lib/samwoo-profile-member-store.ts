import { create } from 'zustand'

type SamwooProfileMemberState = {
  login: string | null
  names: ReadonlyMap<string, string>
  load: (token: string, login: string) => Promise<void>
  clear: () => void
}

let loadSequence = 0

export const useSamwooProfileMemberStore = create<SamwooProfileMemberState>((set) => ({
  login: null,
  names: new Map(),
  load: async (token, login) => {
    const sequence = ++loadSequence
    set((state) => (state.login === login ? state : { login, names: new Map() }))
    const result = await window.api.preflight.samwooProfileMembers.list(token)
    if (sequence !== loadSequence) {
      return
    }
    if (!result.ok) {
      // Why: directory outages must not prevent login-based messaging.
      set({ login, names: new Map() })
      return
    }
    set({
      login,
      names: new Map(
        (result.members ?? []).map((member) => [
          member.login.toLocaleLowerCase(),
          member.name
        ])
      )
    })
  },
  clear: () => {
    loadSequence += 1
    set({ login: null, names: new Map() })
  }
}))
