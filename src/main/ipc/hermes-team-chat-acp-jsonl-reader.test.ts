import { describe, expect, it, vi } from 'vitest'
import { HermesAcpJsonlReader } from './hermes-team-chat-acp-jsonl-reader'

describe('HermesAcpJsonlReader', () => {
  it('preserves split UTF-8 code points across stdout chunks', () => {
    const messages: Record<string, unknown>[] = []
    const reader = new HermesAcpJsonlReader((message) => messages.push(message), vi.fn())
    const frame = Buffer.from(`${JSON.stringify({ id: 1, result: { text: '한글' } })}\n`)
    const split = frame.indexOf(Buffer.from('한')) + 1

    reader.push(frame.subarray(0, split))
    reader.push(frame.subarray(split))

    expect(messages).toEqual([{ id: 1, result: { text: '한글' } }])
  })

  it('bounds unterminated frames and ignores one malformed complete line', () => {
    const onMessage = vi.fn()
    const onOverflow = vi.fn()
    const reader = new HermesAcpJsonlReader(onMessage, onOverflow)

    reader.push(Buffer.from('diagnostic output\n'))
    expect(onMessage).not.toHaveBeenCalled()
    reader.push(Buffer.alloc(8 * 1024 * 1024 + 1, 0x61))
    expect(onOverflow).toHaveBeenCalledOnce()
  })

  it('bounds a large suffix after a complete frame and stays stopped after overflow', () => {
    const onMessage = vi.fn()
    const onOverflow = vi.fn()
    const reader = new HermesAcpJsonlReader(onMessage, onOverflow)
    const suffix = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61)

    reader.push(Buffer.concat([Buffer.from('{"jsonrpc":"2.0"}\n'), suffix]))
    reader.push(Buffer.from('{"jsonrpc":"2.0","id":1,"result":null}\n'))

    expect(onOverflow).toHaveBeenCalledOnce()
    expect(onMessage).toHaveBeenCalledOnce()
  })
})
