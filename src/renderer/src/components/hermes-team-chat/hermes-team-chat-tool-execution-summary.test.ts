import { describe, expect, it } from 'vitest'
import { formatTeamChatToolExecutionSummary } from './hermes-team-chat-tool-execution-summary'

describe('formatTeamChatToolExecutionSummary', () => {
  it('keeps completed and failed side effects in the persisted error message', () => {
    expect(
      formatTeamChatToolExecutionSummary([
        {
          sequence: 1,
          kind: 'local_file',
          operations: [
            { id: 'write', kind: 'write', ok: true, target: 'create_dashboard.py' },
            { id: 'verify', kind: 'read', ok: false, error: 'path is not a supported file' }
          ]
        }
      ])
    ).toBe(
      '실행된 로컬 작업:\n' +
        '- 성공: write (write) · create_dashboard.py\n' +
        '- 실패: read (verify) · path is not a supported file'
    )
  })
})
