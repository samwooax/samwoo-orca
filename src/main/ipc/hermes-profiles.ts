import { exec } from 'node:child_process'
import { ipcMain } from 'electron'

export type HermesProfileListResult = {
  ok: boolean
  stdout: string
  error?: string
}

const LIST_TIMEOUT_MS = 15_000
const DEFAULT_LIST_COMMAND = 'hermes profile list'

/** SAMWOO-ORCA: run the (configurable) Hermes profile-list command so the
 *  start-agent picker can offer one entry per profile. Executed through the
 *  platform shell with the hydrated PATH, matching how terminal tabs resolve
 *  the same command. */
export function registerHermesProfilesHandlers(): void {
  ipcMain.handle(
    'hermes:listProfiles',
    async (_event, args?: { command?: string }): Promise<HermesProfileListResult> => {
      const command = args?.command?.trim() || DEFAULT_LIST_COMMAND
      return new Promise((resolvePromise) => {
        exec(
          command,
          { timeout: LIST_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              resolvePromise({
                ok: false,
                stdout: stdout ?? '',
                error: stderr?.trim() || error.message
              })
              return
            }
            resolvePromise({ ok: true, stdout: stdout ?? '' })
          }
        )
      })
    }
  )
}
