import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approveLocalCommandRequest } from './hermes-local-command-approval'

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
