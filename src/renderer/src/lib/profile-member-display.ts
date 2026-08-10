import { canonicalSamwooLogin } from '../../../shared/samwoo-login-identity'
import type { SamwooProfileMember } from '../../../shared/samwoo-profile-members'

export function profileMemberNameMap(
  members: readonly SamwooProfileMember[]
): ReadonlyMap<string, string> {
  return new Map(
    members.map((member) => [
      canonicalSamwooLogin(member.login),
      member.name.trim() || member.login
    ])
  )
}

export function profileMemberDisplayName(
  login: string,
  directName?: string | null,
  memberNames?: ReadonlyMap<string, string>
): string {
  const direct = directName?.trim()
  return direct || memberNames?.get(canonicalSamwooLogin(login)) || login
}

export function profileMemberInitial(
  login: string,
  directName?: string | null,
  memberNames?: ReadonlyMap<string, string>
): string {
  return (
    Array.from(profileMemberDisplayName(login, directName, memberNames))[0]?.toLocaleUpperCase() ||
    '#'
  )
}
