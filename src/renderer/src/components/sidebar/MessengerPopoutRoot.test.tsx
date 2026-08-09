// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { authSetStateMock, requestSessionMock } = vi.hoisted(() => ({
  authSetStateMock: vi.fn(),
  requestSessionMock: vi.fn(async () => undefined)
}))

let receiveSession: ((session: unknown) => void) | null = null

vi.mock('@/hooks/useSamwooEventStream', () => ({ useSamwooEventStream: vi.fn() }))
vi.mock('@/lib/samwoo-auth-store', () => ({
  useSamwooAuthStore: { setState: authSetStateMock }
}))
vi.mock('./ProfileMessengerWindow', async () => {
  const { Tooltip, TooltipContent, TooltipTrigger } = await import('@/components/ui/tooltip')
  return {
    default: () => (
      <Tooltip>
        <TooltipTrigger>Online 1</TooltipTrigger>
        <TooltipContent>Online members</TooltipContent>
      </Tooltip>
    )
  }
})

import MessengerPopoutRoot from './MessengerPopoutRoot'

describe('MessengerPopoutRoot', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    authSetStateMock.mockReset()
    requestSessionMock.mockClear()
    receiveSession = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        messenger: {
          onSession: (callback: (session: unknown) => void) => {
            receiveSession = callback
            return vi.fn()
          },
          requestSession: requestSessionMock
        }
      }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('provides tooltip context inside the independent messenger renderer root', async () => {
    await act(async () => root.render(<MessengerPopoutRoot initialChannelKey="team" />))
    expect(requestSessionMock).toHaveBeenCalledOnce()

    await act(async () => {
      receiveSession?.({
        login: 'tester',
        name: 'Test User',
        role: null,
        label: null,
        token: 'test-session-token-1234567890'
      })
    })

    expect(authSetStateMock).toHaveBeenCalledWith({
      auth: expect.objectContaining({ login: 'tester' })
    })
    expect(container.querySelector('[data-slot="tooltip-trigger"]')?.textContent).toBe('Online 1')
  })
})
