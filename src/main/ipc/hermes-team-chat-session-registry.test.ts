import { describe, expect, it, vi } from 'vitest'
import type { HermesAcpSession } from './hermes-team-chat-acp-client'
import { HermesTeamChatSessionRegistry } from './hermes-team-chat-session-registry'

function fakeSession() {
  const client = {
    close: vi.fn(),
    isClosed: false
  } as unknown as HermesAcpSession
  return { client, dispose: vi.fn(async () => {}) }
}

describe('HermesTeamChatSessionRegistry', () => {
  it('reuses a released conversation session', async () => {
    const registry = new HermesTeamChatSessionRegistry()
    const session = fakeSession()
    const create = vi.fn(() => session)
    const first = await registry.acquire({
      conversationId: 'conversation-1',
      configurationKey: 'host-profile',
      requestId: 'request-1',
      create
    })
    first.release()
    const second = await registry.acquire({
      conversationId: 'conversation-1',
      configurationKey: 'host-profile',
      requestId: 'request-2',
      create
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.client).toBe(first.client)
    expect(create).toHaveBeenCalledOnce()
    second.release()
    await registry.closeAll()
  })

  it('rejects overlapping prompts in one conversation', async () => {
    const registry = new HermesTeamChatSessionRegistry()
    const create = () => fakeSession()
    await registry.acquire({
      conversationId: 'conversation-2',
      configurationKey: 'host-profile',
      requestId: 'request-1',
      create
    })

    await expect(
      registry.acquire({
        conversationId: 'conversation-2',
        configurationKey: 'host-profile',
        requestId: 'request-2',
        create
      })
    ).rejects.toThrow('already processing')
    await registry.closeAll()
  })

  it('disposes a session when the tab conversation closes', async () => {
    const registry = new HermesTeamChatSessionRegistry()
    const session = fakeSession()
    await registry.acquire({
      conversationId: 'conversation-3',
      configurationKey: 'host-profile',
      requestId: 'request-1',
      create: () => session
    })

    await expect(registry.close('conversation-3')).resolves.toBe(true)
    expect(session.client.close).toHaveBeenCalledOnce()
    expect(session.dispose).toHaveBeenCalledOnce()
  })
})
