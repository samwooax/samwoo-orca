import type { Store } from '../persistence'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import { ipcMain } from 'electron'
import { approveLocalShellCommand } from './hermes-local-command-approval'
import { cancelLocalShellCommand, runLocalShellCommand } from './hermes-local-shell-command'

const REQUEST_ID_RE = /^[A-Za-z0-9._-]+$/
const MAX_COMMAND_CHARS = 32_000

type LocalShellCommandRequest = {
  requestId: string
  command: string
  cwd: string
}

export async function handleHermesLocalShellCommand(
  input: unknown,
  store: Store,
  onProgress?: (event: TeamChatProgressEvent) => void
): Promise<{
  ok: boolean
  status?: 'completed' | 'cancelled'
  exitCode?: number | null
  output?: string
  error?: string
}> {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'invalid request' }
  }
  const parsed = input as Partial<LocalShellCommandRequest>
  const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : ''
  const command = typeof parsed.command === 'string' ? parsed.command.trim() : ''
  const cwd = typeof parsed.cwd === 'string' ? parsed.cwd.slice(0, 512) : ''
  if (
    !REQUEST_ID_RE.test(requestId) ||
    !command ||
    command.length > MAX_COMMAND_CHARS ||
    command.includes('\0')
  ) {
    return { ok: false, error: 'invalid request' }
  }
  if (!cwd.trim()) {
    return { ok: false, error: 'no local project is selected' }
  }

  const progressId = `local-shell-command-${requestId}`
  const title = `Terminal: ${command.slice(0, 200)}`
  onProgress?.({ requestId, id: progressId, kind: 'local_command', title, status: 'in_progress' })
  if (!(await approveLocalShellCommand(command))) {
    onProgress?.({
      requestId,
      id: progressId,
      kind: 'local_command',
      title,
      detail: 'Command execution was denied.',
      status: 'failed'
    })
    return { ok: false, error: 'user denied local command execution' }
  }

  try {
    const result = await runLocalShellCommand({ requestId, command, cwd, store })
    onProgress?.({
      requestId,
      id: progressId,
      kind: 'local_command',
      title,
      detail: result.error ?? result.output.slice(-240),
      status: result.ok ? 'completed' : 'failed'
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onProgress?.({
      requestId,
      id: progressId,
      kind: 'local_command',
      title,
      detail: message,
      status: 'failed'
    })
    return { ok: false, error: message }
  }
}

export function registerHermesLocalShellCommandHandlers(
  store: Store,
  cancelRemoteCommand: (requestId: string) => Promise<boolean>
): void {
  ipcMain.handle('hermes:runLocalShellCommand', async (event, input: unknown) =>
    handleHermesLocalShellCommand(input, store, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('hermes:teamChatProgress', progress)
      }
    })
  )
  ipcMain.handle('hermes:cancelTeamChat', async (_event, requestId: unknown) => {
    const cancelled =
      typeof requestId === 'string' &&
      REQUEST_ID_RE.test(requestId) &&
      ((await cancelRemoteCommand(requestId)) || cancelLocalShellCommand(requestId))
    return { ok: true, cancelled }
  })
}
