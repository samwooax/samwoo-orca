import { app, BrowserWindow, nativeTheme, type WebContents } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Store } from '../persistence'
import { sendToTrustedUIRenderer } from '../ipc/ui'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import { rectHasVisibleAreaOnAnyDisplay } from './window-bounds-validation'

const MIN_WIDTH = 720
const MIN_HEIGHT = 480
const DEFAULT_WIDTH = 1040
const DEFAULT_HEIGHT = 720

let messengerPopoutWindow: BrowserWindow | null = null

export function getMessengerPopoutWindow(): BrowserWindow | null {
  return messengerPopoutWindow &&
    !messengerPopoutWindow.isDestroyed() &&
    !messengerPopoutWindow.webContents.isDestroyed()
    ? messengerPopoutWindow
    : null
}

export function isMessengerPopoutRenderer(sender: WebContents): boolean {
  return getMessengerPopoutWindow()?.webContents === sender
}

function broadcastFocusChanged(focused: boolean): void {
  sendToTrustedUIRenderer('messenger:focusChanged', focused)
}

function loadMessengerPopout(window: BrowserWindow, channelKey?: string): void {
  const search = new URLSearchParams({ surface: 'messenger' })
  if (channelKey) {
    search.set('channel', channelKey)
  }
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/popout.html?${search}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/popout.html'), { search: search.toString() })
  }
}

function resolveRestoredBounds(store: Store | null): Electron.Rectangle | null {
  const raw = store?.getUI().messengerPopoutBounds ?? null
  if (
    raw &&
    raw.width >= MIN_WIDTH &&
    raw.height >= MIN_HEIGHT &&
    rectHasVisibleAreaOnAnyDisplay(raw, MIN_WIDTH / 2, MIN_HEIGHT / 2)
  ) {
    return raw
  }
  if (raw) {
    console.warn('[messenger-popout] Discarding off-screen/near-min popout bounds:', raw)
  }
  return null
}

export function createOrFocusMessengerPopout(
  store: Store | null,
  channelKey?: string
): BrowserWindow {
  const existing = getMessengerPopoutWindow()
  if (existing) {
    if (channelKey) {
      existing.webContents.send('messenger:selectChannel', channelKey)
    }
    if (existing.isMinimized()) {
      existing.restore()
    }
    existing.focus()
    return existing
  }

  const savedBounds = resolveRestoredBounds(store)
  const window = new BrowserWindow({
    width: savedBounds?.width ?? DEFAULT_WIDTH,
    height: savedBounds?.height ?? DEFAULT_HEIGHT,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Orca Messages',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webviewTag: false
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)
  messengerPopoutWindow = window

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
      window.focus()
    }
  })
  window.on('focus', () => broadcastFocusChanged(true))
  window.on('blur', () => broadcastFocusChanged(false))

  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  let closing = false
  const saveBounds = (): void => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
    }
    boundsTimer = setTimeout(() => {
      boundsTimer = null
      if (closing || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) {
        return
      }
      const bounds = window.getBounds()
      if (bounds.width >= MIN_WIDTH && bounds.height >= MIN_HEIGHT) {
        store?.updateUI({ messengerPopoutBounds: bounds })
      }
    }, 500)
  }
  window.on('resize', saveBounds)
  window.on('move', saveBounds)

  const freezeBounds = (): void => {
    closing = true
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
  }
  window.on('close', freezeBounds)
  app.on('before-quit', freezeBounds)
  window.on('closed', () => {
    app.removeListener('before-quit', freezeBounds)
    if (messengerPopoutWindow === window) {
      messengerPopoutWindow = null
    }
    broadcastFocusChanged(false)
  })

  loadMessengerPopout(window, channelKey)
  return window
}

export function closeMessengerPopout(): void {
  const window = getMessengerPopoutWindow()
  if (window) {
    window.close()
  }
  messengerPopoutWindow = null
}
