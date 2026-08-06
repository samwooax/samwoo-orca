import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'

export function SamwooAuthStatusSegment(): React.JSX.Element | null {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)

  if (!auth) {
    return null
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="max-w-48 text-muted-foreground hover:text-foreground"
      onClick={() => void logout()}
      aria-label={translate(
        'samwoo.auth.logoutAriaLabel',
        'Sign out of the groupware account for {{name}}',
        { name: auth.name }
      )}
    >
      <span className="max-w-28 truncate">{auth.name}</span>
      <LogOut />
      <span>{translate('samwoo.auth.logout', 'Sign out')}</span>
    </Button>
  )
}
