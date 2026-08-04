import type { Event } from 'electron'

const DEFAULT_CLEANUP_TIMEOUT_MS = 3_000

type QuitApp = {
  on: (event: 'will-quit', listener: (event: Event) => void) => unknown
  quit: () => void
}

export function registerHermesTeamChatAppCleanup(
  app: QuitApp,
  cleanup: () => Promise<void>,
  timeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS
): void {
  let cleanupStarted = false
  let cleanupDone = false

  app.on('will-quit', (event: Event) => {
    if (cleanupDone) {
      return
    }
    event.preventDefault()
    if (cleanupStarted) {
      return
    }
    cleanupStarted = true
    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      timer.unref?.()
    })
    // Why: persistent SSH/ACP children need a bounded shutdown window before Electron exits.
    void Promise.race([cleanup().catch(() => {}), timeout]).then(() => {
      cleanupDone = true
      app.quit()
    })
  })
}
