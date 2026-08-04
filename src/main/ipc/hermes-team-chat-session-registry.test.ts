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

  it('does not replace an active session when its configuration changes', async () => {
    const registry = new HermesTeamChatSessionRegistry()
    const first = fakeSession()
    await registry.acquire({
      conversationId: 'conversation-active',
      configurationKey: 'host-profile-a',
      requestId: 'request-1',
      create: () => first
    })

    await expect(
      registry.acquire({
        conversationId: 'conversation-active',
        configurationKey: 'host-profile-b',
        requestId: 'request-2',
        create: fakeSession
      })
    ).rejects.toThrow('already processing')
    expect(first.client.close).not.toHaveBeenCalled()
    expect(first.dispose).not.toHaveBeenCalled()
    await registry.closeAll()
  })

  it('serializes concurrent session creation for one conversation', async () => {
    const registry = new HermesTeamChatSessionRegistry()
    const sessions = [fakeSession(), fakeSession()]
    const create = vi.fn(() => sessions[create.mock.calls.length - 1])
    const attempts = await Promise.allSettled([
      registry.acquire({
        conversationId: 'conversation-race',
        configurationKey: 'host-profile',
        requestId: 'request-1',
        create
      }),
      registry.acquire({
        conversationId: 'conversation-race',
        configurationKey: 'host-profile',
        requestId: 'request-2',
        create
      })
    ])

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(create).toHaveBeenCalledOnce()
    await registry.closeAll()
    expect(sessions[0].dispose).toHaveBeenCalledOnce()
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
