import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import { isTrustedUIRenderer, sendToTrustedUIRenderer } from './ui'
import {
  closeMessengerPopout,
  createOrFocusMessengerPopout,
  getMessengerPopoutWindow,
  isMessengerPopoutRenderer
} from '../window/messenger-popout-window'

type MessengerSession = {
  login: string
  name: string
  role: string | null
  label: string | null
  token: string
}

let messengerSession: MessengerSession | null = null

function admitChannelKey(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined
}

function admitSession(value: unknown): MessengerSession | null | undefined {
  if (value === null) {
    return null
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const session = value as Partial<MessengerSession>
  return typeof session.login === 'string' &&
    typeof session.name === 'string' &&
    typeof session.token === 'string' &&
    session.token.length >= 20 &&
    session.token.length <= 256 &&
    (session.role === null || typeof session.role === 'string') &&
    (session.label === null || typeof session.label === 'string')
    ? {
        login: session.login,
        name: session.name,
        role: session.role,
        label: session.label,
        token: session.token
      }
    : undefined
}

export function registerMessengerPopoutHandlers(store: Store): void {
  messengerSession = null
  ipcMain.removeHandler('messenger:open')
  ipcMain.removeHandler('messenger:close')
  ipcMain.removeHandler('messenger:getFocused')
  ipcMain.removeHandler('messenger:publishSession')
  ipcMain.removeHandler('messenger:requestSession')
  ipcMain.removeHandler('messenger:requestLogout')

  ipcMain.handle('messenger:open', (event, channelKey: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      return
    }
    createOrFocusMessengerPopout(store, admitChannelKey(channelKey))
  })
  ipcMain.handle('messenger:close', (event): void => {
    if (isTrustedUIRenderer(event.sender)) {
      closeMessengerPopout()
    }
  })
  ipcMain.handle('messenger:getFocused', (event): boolean =>
    isTrustedUIRenderer(event.sender) ? Boolean(getMessengerPopoutWindow()?.isFocused()) : false
  )
  ipcMain.handle('messenger:publishSession', (event, value: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      return
    }
    const admitted = admitSession(value)
    if (admitted === undefined) {
      return
    }
    messengerSession = admitted
    if (!admitted) {
      closeMessengerPopout()
      return
    }
    getMessengerPopoutWindow()?.webContents.send('messenger:session', admitted)
  })
  ipcMain.handle('messenger:requestSession', (event): void => {
    if (isMessengerPopoutRenderer(event.sender)) {
      event.sender.send('messenger:session', messengerSession)
    }
  })
  ipcMain.handle('messenger:requestLogout', (event): void => {
    if (isMessengerPopoutRenderer(event.sender)) {
      sendToTrustedUIRenderer('messenger:logoutRequested', null)
    }
  })
}
