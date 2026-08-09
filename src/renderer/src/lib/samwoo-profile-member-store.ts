import { create } from 'zustand'
import { canonicalSamwooLogin } from '../../../shared/samwoo-login-identity'
import type { SamwooProfileMember } from '../../../shared/samwoo-profile-members'

type SamwooProfileMemberState = {
  login: string | null
  names: ReadonlyMap<string, string>
  members: readonly SamwooProfileMember[]
  load: (token: string, login: string) => Promise<void>
  clear: () => void
}

let loadSequence = 0

export const useSamwooProfileMemberStore = create<SamwooProfileMemberState>((set) => ({
  login: null,
  names: new Map(),
  members: [],
  load: async (token, login) => {
    login = canonicalSamwooLogin(login)
    const sequence = ++loadSequence
    set((state) => (state.login === login ? state : { login, names: new Map(), members: [] }))
    const result = await window.api.preflight.samwooProfileMembers.list(token)
    if (sequence !== loadSequence) {
      return
    }
    if (!result.ok) {
      // Why: directory outages must not prevent login-based messaging.
      set({ login, names: new Map(), members: [] })
      return
    }
    set({
      login,
      members: (result.members ?? []).map((member) => ({
        ...member,
        login: canonicalSamwooLogin(member.login)
      })),
      names: new Map(
        (result.members ?? []).map((member) => [canonicalSamwooLogin(member.login), member.name])
      )
    })
  },
  clear: () => {
    loadSequence += 1
    set({ login: null, names: new Map(), members: [] })
  }
}))
