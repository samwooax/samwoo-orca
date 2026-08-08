import { app, ipcMain, type WebContents } from 'electron'
import type { SamwooEventStreamState } from '../../shared/samwoo-profile-messaging'
import { SAMWOO_AUTH_SERVICE_URL } from '../../shared/samwoo-service-endpoints'
import {
  getMessengerPopoutWindow,
  isMessengerPopoutRenderer
} from '../window/messenger-popout-window'
import { SamwooEventStreamClient } from './samwoo-event-stream-client'
import { getTrustedUIRendererWebContents, isTrustedUIRenderer } from './ui'

function hasToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 256
}

function sendIfAvailable(target: WebContents | null, channel: string, payload: unknown): void {
  if (target && !target.isDestroyed()) {
    target.send(channel, payload)
  }
}

function broadcast(channel: string, payload: unknown): void {
  const mainRenderer = getTrustedUIRendererWebContents()
  sendIfAvailable(mainRenderer, channel, payload)
  const popoutRenderer = getMessengerPopoutWindow()?.webContents ?? null
  if (popoutRenderer?.id !== mainRenderer?.id) {
    sendIfAvailable(popoutRenderer, channel, payload)
  }
}

const eventStream = new SamwooEventStreamClient({
  baseUrl: SAMWOO_AUTH_SERVICE_URL,
  emitEvent: (event) => broadcast('samwoo:eventStream:event', event),
  emitStatus: (status) => broadcast('samwoo:eventStream:status', status)
})

let registered = false

export function registerSamwooEventStreamHandlers(): void {
  if (registered) {
    return
  }
  registered = true
  ipcMain.handle('samwoo:eventStream:start', (event, token: unknown): void => {
    if (isTrustedUIRenderer(event.sender) && hasToken(token)) {
      eventStream.start(token)
    }
  })
  ipcMain.handle('samwoo:eventStream:stop', (event): void => {
    if (isTrustedUIRenderer(event.sender)) {
      eventStream.stop()
    }
  })
  ipcMain.handle(
    'samwoo:eventStream:getState',
    (event): SamwooEventStreamState =>
      isTrustedUIRenderer(event.sender) || isMessengerPopoutRenderer(event.sender)
        ? eventStream.state()
        : { status: 'disconnected', onlineLogins: [] }
  )
  app.once('will-quit', () => eventStream.stop(false))
}
