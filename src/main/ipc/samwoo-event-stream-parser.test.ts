import { describe, expect, it, vi } from 'vitest'
import { SamwooEventStreamParser, admitSamwooProfileEvent } from './samwoo-event-stream-parser'

describe('SAMWOO event stream parser', () => {
  it('parses UTF-8 events across chunks and ignores heartbeats', () => {
    const onEvent = vi.fn()
    const parser = new SamwooEventStreamParser(onEvent)
    const payload = Buffer.from('data: {"type":"presence","online":["홍길동"]}\n\n: ping\n\n')

    parser.push(payload.subarray(0, 41))
    parser.push(payload.subarray(41))

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith({ type: 'presence', online: ['홍길동'] })
  })

  it('ignores malformed and unknown events without poisoning the next event', () => {
    const onEvent = vi.fn()
    const parser = new SamwooEventStreamParser(onEvent)

    parser.push(
      Buffer.from('data: not-json\n\ndata: {"type":"unknown"}\n\ndata: {"type":"expired"}\n\n')
    )

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent).toHaveBeenCalledWith({ type: 'expired' })
  })

  it('rejects incomplete message payloads at the main-process boundary', () => {
    expect(admitSamwooProfileEvent({ type: 'message', channelKey: 'team', message: {} })).toBeNull()
  })

  it('admits bounded workspace assignment events and rejects incomplete ones', () => {
    const event = {
      type: 'workspace-assignees',
      shareId: 'share-1',
      displayName: 'Design',
      addedLogins: ['peer'],
      updatedBy: 'owner',
      updatedAt: 123
    }
    expect(admitSamwooProfileEvent(event)).toEqual(event)
    expect(admitSamwooProfileEvent({ ...event, addedLogins: [123] })).toBeNull()
  })
})
