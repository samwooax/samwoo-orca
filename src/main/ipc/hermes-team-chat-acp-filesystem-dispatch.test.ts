import { describe, expect, it, vi } from 'vitest'
import type { HermesAcpFilesystem } from './hermes-team-chat-acp-filesystem'
import { HermesAcpFilesystemRequestDispatcher } from './hermes-team-chat-acp-filesystem-dispatch'

function createDispatcher(handle = vi.fn().mockResolvedValue({ content: 'ok' })) {
  const resetReadRevisions = vi.fn()
  const filesystem = { handle, resetReadRevisions } as unknown as HermesAcpFilesystem
  return {
    dispatcher: new HermesAcpFilesystemRequestDispatcher(filesystem),
    handle,
    resetReadRevisions
  }
}

describe('HermesAcpFilesystemRequestDispatcher', () => {
  it('requires an active turn and the exact ACP session', async () => {
    const { dispatcher, handle, resetReadRevisions } = createDispatcher()
    const message = {
      jsonrpc: '2.0',
      id: 7,
      method: 'fs/read_text_file',
      params: { sessionId: 'session-a', path: '/workspace/a.txt' }
    }

    await expect(dispatcher.dispatch(message, 'session-a')).resolves.toMatchObject({
      error: { code: -32_800 }
    })
    dispatcher.beginTurn()
    await expect(dispatcher.dispatch({ ...message, id: 8 }, 'session-b')).resolves.toMatchObject({
      error: { code: -32_602 }
    })
    await expect(
      dispatcher.dispatch({ ...message, id: 9, params: { ...message.params, sessionId: '' } }, '')
    ).resolves.toMatchObject({ error: { code: -32_602 } })
    expect(handle).not.toHaveBeenCalled()
    expect(resetReadRevisions).toHaveBeenCalledOnce()
  })

  it('executes a duplicate inbound id only once', async () => {
    let release = (_value: unknown): void => {}
    const result = new Promise((resolve) => {
      release = resolve
    })
    const { dispatcher, handle } = createDispatcher(vi.fn().mockReturnValue(result))
    dispatcher.beginTurn()
    const message = {
      jsonrpc: '2.0',
      id: 'same-id',
      method: 'fs/read_text_file',
      params: { sessionId: 'session-a', path: '/workspace/a.txt' }
    }

    const first = dispatcher.dispatch(message, 'session-a')
    const duplicate = dispatcher.dispatch(message, 'session-a')
    release({ content: 'once' })

    await expect(first).resolves.toMatchObject({ result: { content: 'once' } })
    await expect(duplicate).resolves.toMatchObject({ result: { content: 'once' } })
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('returns cancellation instead of a late filesystem response', async () => {
    let release = (_value: unknown): void => {}
    let canCommit = (): boolean => true
    const result = new Promise((resolve) => {
      release = resolve
    })
    const handle = vi.fn((_method: string, _params: unknown, commitGuard: () => boolean) => {
      canCommit = commitGuard
      return result
    })
    const { dispatcher } = createDispatcher(handle)
    dispatcher.beginTurn()
    const response = dispatcher.dispatch(
      {
        id: 9,
        method: 'fs/read_text_file',
        params: { sessionId: 'session-a', path: '/workspace/a.txt' }
      },
      'session-a'
    )
    expect(canCommit()).toBe(true)
    dispatcher.cancelTurn()
    expect(canCommit()).toBe(false)
    release({ content: 'late' })

    await expect(response).resolves.toMatchObject({ error: { code: -32_800 } })
  })

  it('caps aggregate read content and never accepts terminal methods', async () => {
    const content = 'x'.repeat(512 * 1024)
    const { dispatcher } = createDispatcher(vi.fn().mockResolvedValue({ content }))
    dispatcher.beginTurn()
    for (let index = 0; index < 8; index += 1) {
      await expect(
        dispatcher.dispatch(
          {
            id: index,
            method: 'fs/read_text_file',
            params: { sessionId: 'session-a', path: `/workspace/${index}.txt` }
          },
          'session-a'
        )
      ).resolves.toMatchObject({ result: { content } })
    }
    await expect(
      dispatcher.dispatch(
        {
          id: 10,
          method: 'fs/read_text_file',
          params: { sessionId: 'session-a', path: '/workspace/overflow.txt' }
        },
        'session-a'
      )
    ).resolves.toMatchObject({ error: { code: -32_000 } })
    expect(dispatcher.isSupportedMethod('terminal/create')).toBe(false)
  })

  it('cancels one request and bounds request ids without retaining an old turn', async () => {
    const pending = new Promise(() => {})
    const handle = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce({ content: 'next turn' })
    const { dispatcher } = createDispatcher(handle)
    dispatcher.beginTurn()
    const first = dispatcher.dispatch(
      {
        id: 'first',
        method: 'fs/read_text_file',
        params: { sessionId: 'session-a', path: '/workspace/a.txt' }
      },
      'session-a'
    )
    dispatcher.cancelRequest('first')
    dispatcher.cancelTurn()
    dispatcher.beginTurn()

    await expect(
      dispatcher.dispatch(
        {
          id: 'next',
          method: 'fs/read_text_file',
          params: { sessionId: 'session-a', path: '/workspace/b.txt' }
        },
        'session-a'
      )
    ).resolves.toMatchObject({ result: { content: 'next turn' } })
    await expect(
      dispatcher.dispatch(
        {
          id: 'x'.repeat(257),
          method: 'fs/read_text_file',
          params: { sessionId: 'session-a', path: '/workspace/c.txt' }
        },
        'session-a'
      )
    ).resolves.toMatchObject({ error: { code: -32_600 }, id: '' })
    expect(handle).toHaveBeenCalledTimes(2)
    void first
  })
})
