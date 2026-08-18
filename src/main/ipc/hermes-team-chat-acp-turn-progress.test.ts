import { describe, expect, it, vi } from 'vitest'
import { HermesAcpTurnProgress } from './hermes-team-chat-acp-turn-progress'

describe('HermesAcpTurnProgress', () => {
  it('bounds retained reply and tool identifiers', () => {
    const turn = new HermesAcpTurnProgress('request-1', vi.fn())
    turn.handleUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'x'.repeat(4 * 1024 * 1024) }
    })

    expect(() =>
      turn.handleUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'overflow' }
      })
    ).toThrow('size limit')
    expect(() =>
      turn.handleUpdate({
        sessionUpdate: 'tool_call',
        toolCallId: 'x'.repeat(257),
        title: 'tool'
      })
    ).toThrow('tool id')
  })
})
