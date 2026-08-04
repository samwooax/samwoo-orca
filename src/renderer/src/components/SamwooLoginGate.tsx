import { useState } from 'react'
import { resolveSamwooLoginProfile } from '@/lib/samwoo-login-profile'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import logo from '../../../../resources/logo.svg'

/** SAMWOO-ORCA: full-screen login shown at startup until the employee signs in
 *  with their groupware account. On success the mapped team-bot role is stored
 *  and projects auto-open that role's chat. */
export default function SamwooLoginGate(): React.JSX.Element | null {
  const auth = useSamwooAuthStore((s) => s.auth)
  const setAuth = useSamwooAuthStore((s) => s.setAuth)
  // Why: the SAMWOO wordmark asset is white. Under a light app theme the login
  // background is light, so invert the logo to dark to keep it visible.
  const theme = useAppStore((s) => s.settings?.theme)
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = theme === 'dark' || (theme !== 'light' && prefersDark)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (auth) {
    return null
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || !login.trim() || !password) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.preflight.samwooLogin({ login: login.trim(), password })
      if (!result.ok) {
        setError(
          result.error === 'invalid credentials'
            ? translate('samwoo.login.invalidCredentials', 'The username or password is incorrect.')
            : translate('samwoo.login.failed', 'Login failed: {{error}}', {
                error: result.error ?? translate('samwoo.login.unknownError', 'Unknown error')
              })
        )
        return
      }
      setAuth({
        login: result.login ?? login.trim(),
        name: result.name ?? login.trim(),
        role: resolveSamwooLoginProfile(result),
        label: result.label ?? null,
        token: result.token
      })
    } catch (err) {
      setError(
        translate('samwoo.login.connectionError', 'Connection error: {{error}}', {
          error: String(err)
        })
      )
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background text-foreground">
      <form
        onSubmit={submit}
        className="mx-4 flex w-full max-w-sm flex-col gap-3.5 rounded-xl border border-border bg-card p-7 shadow-xs"
      >
        <img
          src={logo}
          alt={translate('samwoo.login.logoAlt', 'SAMWOO')}
          className="mb-0.5 block h-5 w-auto max-w-64 self-center object-contain"
          style={{ filter: isDark ? 'none' : 'invert(1)' }}
        />
        <div className="mb-1 text-center text-sm text-muted-foreground">
          {translate('samwoo.login.description', 'Sign in with your groupware account')}
        </div>
        <Input
          autoFocus
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder={translate('samwoo.login.usernamePlaceholder', 'Username or email')}
          autoComplete="username"
        />
        <Input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={translate('samwoo.login.passwordPlaceholder', 'Password')}
          type="password"
          autoComplete="current-password"
        />
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        <Button type="submit" disabled={busy || !login.trim() || !password} className="mt-1">
          {busy
            ? translate('samwoo.login.checking', 'Checking…')
            : translate('samwoo.login.submit', 'Sign in')}
        </Button>
      </form>
    </div>
  )
}
