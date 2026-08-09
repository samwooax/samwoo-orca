export function canonicalSamwooLogin(value: unknown): string {
  const login = String(value ?? '').trim()
  return (login.includes('@') ? login.slice(0, login.indexOf('@')) : login).toLowerCase()
}
