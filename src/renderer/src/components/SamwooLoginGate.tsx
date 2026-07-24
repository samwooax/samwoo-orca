import { useState } from 'react'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useAppStore } from '@/store'
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
            ? '아이디 또는 비밀번호가 올바르지 않습니다.'
            : `로그인 실패: ${result.error ?? '알 수 없는 오류'}`
        )
        return
      }
      setAuth({
        login: result.login ?? login.trim(),
        name: result.name ?? login.trim(),
        role: result.role ?? null,
        label: result.label ?? null,
        token: result.token
      })
    } catch (err) {
      setError(`연결 오류: ${String(err)}`)
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--background, #0e0e12)',
        color: 'var(--foreground, #ececf1)'
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 340,
          maxWidth: '90vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 28,
          borderRadius: 16,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.10)'
        }}
      >
        <img
          src={logo}
          alt="SAMWOO"
          style={{
            height: 20,
            width: 'auto',
            maxWidth: '70%',
            objectFit: 'contain',
            alignSelf: 'center',
            display: 'block',
            marginBottom: 2,
            filter: isDark ? 'none' : 'invert(1)'
          }}
        />
        <div style={{ textAlign: 'center', fontSize: 13, opacity: 0.7, marginBottom: 4 }}>
          그룹웨어 계정으로 로그인하세요
        </div>
        <input
          autoFocus
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          placeholder="아이디 또는 이메일"
          autoComplete="username"
          style={inputStyle}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          type="password"
          autoComplete="current-password"
          style={inputStyle}
        />
        {error ? <div style={{ color: '#fca5a5', fontSize: 12.5 }}>{error}</div> : null}
        <button
          type="submit"
          disabled={busy || !login.trim() || !password}
          style={{
            marginTop: 4,
            padding: '10px 14px',
            borderRadius: 10,
            border: 0,
            background: busy ? '#3b5bbf' : '#2563eb',
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            cursor: busy ? 'default' : 'pointer',
            opacity: !login.trim() || !password ? 0.5 : 1
          }}
        >
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(0,0,0,0.25)',
  color: 'inherit',
  fontSize: 14,
  outline: 'none'
}
