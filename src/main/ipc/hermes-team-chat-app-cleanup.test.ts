import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { registerHermesTeamChatAppCleanup } from './hermes-team-chat-app-cleanup'

class FakeApp extends EventEmitter {
  quit = vi.fn()
}

describe('registerHermesTeamChatAppCleanup', () => {
  it('waits for session cleanup before retrying app quit', async () => {
    const app = new FakeApp()
    let finishCleanup = (): void => {}
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve
        })
    )
    registerHermesTeamChatAppCleanup(app, cleanup)
    const firstEvent = { preventDefault: vi.fn() }
    const repeatedEvent = { preventDefault: vi.fn() }

    app.emit('will-quit', firstEvent)
    app.emit('will-quit', repeatedEvent)
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()

    finishCleanup()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    const finalEvent = { preventDefault: vi.fn() }
    app.emit('will-quit', finalEvent)
    expect(finalEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('fails open after the cleanup timeout', async () => {
    vi.useFakeTimers()
    const app = new FakeApp()
    registerHermesTeamChatAppCleanup(app, () => new Promise<void>(() => {}), 50)

    app.emit('will-quit', { preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(50)
    expect(app.quit).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
