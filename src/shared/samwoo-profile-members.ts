export type SamwooProfileMember = {
  login: string
  name: string
}

export type SamwooProfileMembersResult = {
  ok: boolean
  members?: SamwooProfileMember[]
  error?: string
}
