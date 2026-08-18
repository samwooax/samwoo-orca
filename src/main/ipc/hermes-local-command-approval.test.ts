import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveHermesAcpTerminalCommand,
  approveLocalCommandRequest
} from './hermes-local-command-approval'

const { getFocusedWindowMock, showMessageBoxMock } = vi.hoisted(() => ({
  getFocusedWindowMock: vi.fn(),
  showMessageBoxMock: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: getFocusedWindowMock },
  dialog: { showMessageBox: showMessageBoxMock }
}))

beforeEach(() => {
  getFocusedWindowMock.mockReset().mockReturnValue(null)
  showMessageBoxMock.mockReset().mockResolvedValue({ response: 1 })
})

describe('approveLocalCommandRequest', () => {
  it('denies by default and renders arguments as escaped data', async () => {
    await expect(
      approveLocalCommandRequest({
        version: 1,
        operations: [
          {
            id: 'run',
            kind: 'run',
            command: 'python3',
            args: ['-c', 'print("hello")\nprint("world")'],
            mode: 'foreground'
          }
        ]
      })
    ).resolves.toBe(false)

    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultId: 1,
        cancelId: 1,
        detail: 'python3 "-c" "print(\\"hello\\")\\nprint(\\"world\\")"'
      })
    )
  })

  it('allows a run only after the user chooses Allow once', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    await expect(
      approveLocalCommandRequest({
        version: 1,
        operations: [
          { id: 'run', kind: 'run', command: 'uv', args: ['run', 'app.py'], mode: 'foreground' }
        ]
      })
    ).resolves.toBe(true)
  })

  it('does not prompt when the request only stops a process', async () => {
    await expect(
      approveLocalCommandRequest({
        version: 1,
        operations: [{ id: 'stop', kind: 'stop', processId: 'process-1' }]
      })
    ).resolves.toBe(true)
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })
})

describe('approveHermesAcpTerminalCommand', () => {
  it('shows the unsandboxed boundary before a visibly delimited command', async () => {
    await expect(
      approveHermesAcpTerminalCommand('echo safe\u202eevil\u001b[31m', 'C:\\repo')
    ).resolves.toBe(false)

    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultId: 1,
        cancelId: 1,
        detail:
          'This command is not sandboxed. It can access files outside the project and the network, bypass file backups, and return its output to Hermes. Approval expires after 45 seconds.\n\nWorking directory:\nC:\\\\repo\n\nCommand:\necho safe\\u{202e}evil\\u{1b}[31m'
      })
    )
  })
})
