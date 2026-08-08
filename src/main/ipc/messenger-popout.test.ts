import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  createOrFocusMock,
  closeMock,
  trustedMock,
  popoutRendererMock,
  sendToTrustedUIRendererMock,
  windowRef
} = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  createOrFocusMock: vi.fn(),
  closeMock: vi.fn(),
  trustedMock: vi.fn(() => true),
  popoutRendererMock: vi.fn(() => true),
  sendToTrustedUIRendererMock: vi.fn(),
  windowRef: {
    current: null as null | {
      isFocused: () => boolean
      webContents?: { send: ReturnType<typeof vi.fn> }
    }
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
    )
  }
}))
vi.mock('./ui', () => ({
  isTrustedUIRenderer: trustedMock,
  sendToTrustedUIRenderer: sendToTrustedUIRendererMock
}))
vi.mock('../window/messenger-popout-window', () => ({
  createOrFocusMessengerPopout: createOrFocusMock,
  closeMessengerPopout: closeMock,
  getMessengerPopoutWindow: () => windowRef.current,
  isMessengerPopoutRenderer: popoutRendererMock
}))

import { registerMessengerPopoutHandlers } from './messenger-popout'

describe('messenger popout IPC', () => {
  beforeEach(() => {
    handlers.clear()
    createOrFocusMock.mockReset()
    closeMock.mockReset()
    trustedMock.mockReset().mockReturnValue(true)
    popoutRendererMock.mockReset().mockReturnValue(true)
    sendToTrustedUIRendererMock.mockReset()
    windowRef.current = null
    registerMessengerPopoutHandlers({} as never)
  })

  it('opens one admitted channel only for the trusted main renderer', () => {
    const open = handlers.get('messenger:open')!
    open({ sender: {} }, 'workspace:share-1')
    expect(createOrFocusMock).toHaveBeenCalledWith({}, 'workspace:share-1')
    createOrFocusMock.mockClear()
    trustedMock.mockReturnValue(false)
    open({ sender: {} }, 'team')
    expect(createOrFocusMock).not.toHaveBeenCalled()
  })

  it('drops oversized channel keys and reports actual focus state', () => {
    handlers.get('messenger:open')!({ sender: {} }, 'x'.repeat(201))
    expect(createOrFocusMock).toHaveBeenCalledWith({}, undefined)
    windowRef.current = { isFocused: () => true }
    expect(handlers.get('messenger:getFocused')!({ sender: {} })).toBe(true)
  })

  it('closes only for the trusted renderer', () => {
    const close = handlers.get('messenger:close')!
    trustedMock.mockReturnValue(false)
    close({ sender: {} })
    expect(closeMock).not.toHaveBeenCalled()
    trustedMock.mockReturnValue(true)
    close({ sender: {} })
    expect(closeMock).toHaveBeenCalledOnce()
  })

  it('relays only admitted sessions and logout requests across the window boundary', () => {
    const send = vi.fn()
    windowRef.current = { isFocused: () => true, webContents: { send } }
    const session = {
      login: 'kim',
      name: 'Kim',
      role: null,
      label: null,
      token: 'token-owner-0123456789'
    }
    handlers.get('messenger:publishSession')!({ sender: {} }, session)
    expect(send).toHaveBeenCalledWith('messenger:session', session)

    const popoutSender = { send: vi.fn() }
    handlers.get('messenger:requestSession')!({ sender: popoutSender })
    expect(popoutSender.send).toHaveBeenCalledWith('messenger:session', session)
    handlers.get('messenger:requestLogout')!({ sender: popoutSender })
    expect(sendToTrustedUIRendererMock).toHaveBeenCalledWith('messenger:logoutRequested', null)
  })
})
