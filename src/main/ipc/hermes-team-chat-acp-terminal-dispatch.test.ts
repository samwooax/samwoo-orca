import { describe, expect, it, vi } from 'vitest'
import type { HermesAcpTerminal } from './hermes-team-chat-acp-terminal'
import { HermesAcpTerminalRequestDispatcher } from './hermes-team-chat-acp-terminal-dispatch'

const SUPPORTED_METHODS = new Set([
  'terminal/create',
  'terminal/output',
  'terminal/wait_for_exit',
  'terminal/kill',
  'terminal/release'
])

function createDispatcher(handle = vi.fn().mockResolvedValue({ output: 'ok' })) {
  const terminal = {
    handle,
    isSupportedMethod: vi.fn((method: unknown) => SUPPORTED_METHODS.has(String(method))),
    endGeneration: vi.fn(),
    cancelGeneration: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined)
  } as unknown as HermesAcpTerminal
  return {
    dispatcher: new HermesAcpTerminalRequestDispatcher(terminal),
    terminal,
    handle
  }
}

function outputMessage(id: string | number, sessionId = 'session-a') {
  return {
    jsonrpc: '2.0',
    id,
    method: 'terminal/output',
    params: { sessionId, terminalId: '00000000-0000-4000-8000-000000000000' }
  }
}

describe('HermesAcpTerminalRequestDispatcher', () => {
  it('requires an active turn and the exact non-empty ACP session', async () => {
    const { dispatcher, handle } = createDispatcher()

    await expect(dispatcher.dispatch(outputMessage(1), 'session-a')).resolves.toMatchObject({
      error: { code: -32_800 }
    })
    dispatcher.beginTurn()
    await expect(dispatcher.dispatch(outputMessage(2), 'session-b')).resolves.toMatchObject({
      error: { code: -32_602 }
    })
    await expect(dispatcher.dispatch(outputMessage(3, ''), '')).resolves.toMatchObject({
      error: { code: -32_602 }
    })
    expect(handle).not.toHaveBeenCalled()
  })

  it('executes duplicate in-flight and completed request ids only once per turn', async () => {
    let release = (_value: unknown): void => {}
    const pending = new Promise((resolve) => {
      release = resolve
    })
    const { dispatcher, handle } = createDispatcher(vi.fn().mockReturnValue(pending))
    dispatcher.beginTurn()
    const message = outputMessage('same-id')

    const first = dispatcher.dispatch(message, 'session-a')
    const duplicate = dispatcher.dispatch(message, 'session-a')
    release({ output: 'once' })

    await expect(first).resolves.toMatchObject({ result: { output: 'once' } })
    await expect(duplicate).resolves.toMatchObject({ result: { output: 'once' } })
    await expect(dispatcher.dispatch(message, 'session-a')).resolves.toMatchObject({
      result: { output: 'once' }
    })
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('aborts one in-flight request without cancelling the terminal generation', async () => {
    let observedSignal: AbortSignal | undefined
    let observedGuard: (() => boolean) | undefined
    const handle = vi.fn(
      (
        _method: string,
        _params: unknown,
        _generation: number,
        canContinue: () => boolean,
        signal: AbortSignal
      ) => {
        observedSignal = signal
        observedGuard = canContinue
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
      }
    )
    const { dispatcher, terminal } = createDispatcher(handle)
    dispatcher.beginTurn()

    const response = dispatcher.dispatch(outputMessage('cancel-me'), 'session-a')
    expect(observedGuard?.()).toBe(true)
    dispatcher.cancelRequest('cancel-me')

    await expect(response).resolves.toMatchObject({ error: { code: -32_800 } })
    expect(observedSignal?.aborted).toBe(true)
    expect(observedGuard?.()).toBe(false)
    expect(terminal.cancelGeneration).not.toHaveBeenCalled()
  })

  it('cancels the old generation and permits the same id in a later turn', async () => {
    let firstSignal: AbortSignal | undefined
    const handle = vi
      .fn()
      .mockImplementationOnce(
        (
          _method: string,
          _params: unknown,
          _generation: number,
          _canContinue: () => boolean,
          signal: AbortSignal
        ) => {
          firstSignal = signal
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
          })
        }
      )
      .mockResolvedValueOnce({ output: 'new generation' })
    const { dispatcher, terminal } = createDispatcher(handle)
    dispatcher.beginTurn()
    const first = dispatcher.dispatch(outputMessage('reused'), 'session-a')

    dispatcher.cancelTurn()
    expect(firstSignal?.aborted).toBe(true)
    expect(terminal.cancelGeneration).toHaveBeenCalledWith(1)
    await expect(first).resolves.toMatchObject({ error: { code: -32_800 } })

    dispatcher.beginTurn()
    await expect(dispatcher.dispatch(outputMessage('reused'), 'session-a')).resolves.toMatchObject({
      result: { output: 'new generation' }
    })
    dispatcher.endTurn()
    expect(terminal.endGeneration).toHaveBeenCalledWith(3)
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('aborts terminal creation before the remote bridge deadline', async () => {
    vi.useFakeTimers()
    const handle = vi.fn(
      (
        _method: string,
        _params: unknown,
        _generation: number,
        _canContinue: () => boolean,
        signal: AbortSignal
      ) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
    )
    const { dispatcher } = createDispatcher(handle)
    dispatcher.beginTurn()
    const response = dispatcher.dispatch(
      {
        jsonrpc: '2.0',
        id: 'slow-approval',
        method: 'terminal/create',
        params: { sessionId: 'session-a', command: 'echo ok' }
      },
      'session-a'
    )

    await vi.advanceTimersByTimeAsync(45_000)

    await expect(response).resolves.toMatchObject({ error: { code: -32_800 } })
    vi.useRealTimers()
  })
})
