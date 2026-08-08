import { useEffect } from 'react'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooMessageInboxStore } from '@/lib/samwoo-message-inbox-store'

export function useMessengerPopoutBridge(): void {
  const auth = useSamwooAuthStore((state) => state.auth)
  const logout = useSamwooAuthStore((state) => state.logout)

  useEffect(() => {
    const setFocused = (focused: boolean): void =>
      useSamwooMessageInboxStore.getState().setMessengerOpen(focused)
    const offFocusChanged = window.api.messenger.onFocusChanged(setFocused)
    void window.api.messenger.getFocused().then(setFocused)
    return () => {
      offFocusChanged()
      setFocused(false)
    }
  }, [])

  useEffect(() => {
    void window.api.messenger.publishSession(auth)
  }, [auth])

  useEffect(() => window.api.messenger.onLogoutRequested(() => void logout()), [logout])
}
