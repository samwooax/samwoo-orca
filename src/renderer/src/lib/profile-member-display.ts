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
import { canonicalSamwooLogin } from '../../../shared/samwoo-login-identity'
