import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { instances, BrowserWindowMock, sendToTrustedUIRendererMock, appRemoveListenerMock, isMock } =
  vi.hoisted(() => {
    const created: FakeWindow[] = []
    class FakeWindow {
      handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
      onceHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}
      destroyed = false
      minimized = false
      focused = false
      options: Electron.BrowserWindowConstructorOptions
      bounds = { x: 100, y: 100, width: 1040, height: 720 }
      webContents = {
        send: vi.fn(),
        isDestroyed: () => this.destroyed,
        session: {
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn()
        }
      }
      focus = vi.fn(() => {
        this.focused = true
      })
      show = vi.fn()
      restore = vi.fn(() => {
        this.minimized = false
      })
      loadURL = vi.fn()
      loadFile = vi.fn()
      close = vi.fn(() => {
        this.emit('close')
        this.destroyed = true
        this.emit('closed')
      })

      constructor(options: Electron.BrowserWindowConstructorOptions) {
        this.options = options
        created.push(this)
      }
      on(event: string, callback: (...args: unknown[]) => void): this {
        ;(this.handlers[event] ||= []).push(callback)
        return this
      }
      once(event: string, callback: (...args: unknown[]) => void): this {
        ;(this.onceHandlers[event] ||= []).push(callback)
        return this
      }
      emit(event: string): void {
        for (const callback of this.handlers[event] ?? []) {
          callback()
        }
        for (const callback of this.onceHandlers[event] ?? []) {
          callback()
        }
      }
      isDestroyed(): boolean {
        return this.destroyed
      }
      isMinimized(): boolean {
        return this.minimized
      }
      isFocused(): boolean {
        return this.focused
      }
      isFullScreen(): boolean {
        return false
      }
      getBounds(): Electron.Rectangle {
        return this.bounds
      }
    }
    return {
      instances: created,
      BrowserWindowMock: FakeWindow,
      sendToTrustedUIRendererMock: vi.fn(),
      appRemoveListenerMock: vi.fn(),
      isMock: { dev: false } as { dev: boolean }
    }
  })

vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: appRemoveListenerMock },
  BrowserWindow: BrowserWindowMock,
  nativeTheme: { shouldUseDarkColors: false },
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
  }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: isMock }))
vi.mock('../ipc/ui', () => ({ sendToTrustedUIRenderer: sendToTrustedUIRendererMock }))
vi.mock('./privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))

import {
  closeMessengerPopout,
  createOrFocusMessengerPopout,
  isMessengerPopoutRenderer
} from './messenger-popout-window'

type FakeWindow = InstanceType<typeof BrowserWindowMock>

function makeStore(bounds?: Electron.Rectangle): {
  getUI: () => { messengerPopoutBounds?: Electron.Rectangle }
  updateUI: ReturnType<typeof vi.fn>
} {
  return { getUI: () => ({ messengerPopoutBounds: bounds }), updateUI: vi.fn() }
}

describe('messenger popout window', () => {
  beforeEach(() => {
    instances.length = 0
    isMock.dev = false
  })
  afterEach(() => {
    closeMessengerPopout()
    vi.clearAllMocks()
  })

  it('creates one movable companion window with required minimum bounds', () => {
    const first = createOrFocusMessengerPopout(
      makeStore() as never,
      'team'
    ) as unknown as FakeWindow
    const second = createOrFocusMessengerPopout(makeStore() as never, 'workspace:a')
    expect(second).toBe(first)
    expect(instances).toHaveLength(1)
    expect(first.options).toMatchObject({ minWidth: 720, minHeight: 480, show: false })
    expect(first.webContents.send).toHaveBeenCalledWith('messenger:selectChannel', 'workspace:a')
    expect(first.focus).toHaveBeenCalled()
  })

  it('identifies only the live messenger renderer', () => {
    const window = createOrFocusMessengerPopout(makeStore() as never) as unknown as FakeWindow
    expect(isMessengerPopoutRenderer(window.webContents as never)).toBe(true)
    expect(isMessengerPopoutRenderer({} as never)).toBe(false)
  })

  it('restores and remembers visible window bounds', () => {
    vi.useFakeTimers()
    const store = makeStore({ x: 240, y: 180, width: 900, height: 640 })
    const window = createOrFocusMessengerPopout(store as never) as unknown as FakeWindow
    expect(window.options).toMatchObject({ x: 240, y: 180, width: 900, height: 640 })
    window.bounds = { x: 300, y: 220, width: 980, height: 680 }
    window.emit('move')
    vi.advanceTimersByTime(500)
    expect(store.updateUI).toHaveBeenCalledWith({ messengerPopoutBounds: window.bounds })
    vi.useRealTimers()
  })

  it('broadcasts focus, blur, and close state to the main renderer', () => {
    const window = createOrFocusMessengerPopout(makeStore() as never) as unknown as FakeWindow
    window.emit('focus')
    window.emit('blur')
    window.close()
    expect(sendToTrustedUIRendererMock.mock.calls).toEqual([
      ['messenger:focusChanged', true],
      ['messenger:focusChanged', false],
      ['messenger:focusChanged', false]
    ])
  })
})
