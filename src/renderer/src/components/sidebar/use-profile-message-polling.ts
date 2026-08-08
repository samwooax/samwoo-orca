import { useEffect } from 'react'
import { shouldPollProfileMessages } from './profile-message-interaction-admission'

type ProfileMessagePollingOptions = {
  enabled: boolean
  refresh: (showProgress: boolean) => Promise<void>
  showInitialProgress: boolean
  foregroundRefreshMs: number
  backgroundRefreshMs: number
}

export function useProfileMessagePolling(options: ProfileMessagePollingOptions): void {
  const { enabled, refresh, showInitialProgress, foregroundRefreshMs, backgroundRefreshMs } =
    options

  useEffect(() => {
    if (!enabled) {
      return
    }
    void refresh(showInitialProgress)
    let lastPollAt = Date.now()
    const interval = window.setInterval(() => {
      const now = Date.now()
      if (
        shouldPollProfileMessages({
          documentHidden: document.hidden,
          elapsedMs: now - lastPollAt,
          backgroundRefreshMs
        })
      ) {
        lastPollAt = now
        void refresh(false)
      }
    }, foregroundRefreshMs)
    return () => window.clearInterval(interval)
  }, [backgroundRefreshMs, enabled, foregroundRefreshMs, refresh, showInitialProgress])
}
