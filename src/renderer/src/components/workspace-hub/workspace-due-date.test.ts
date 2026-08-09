import { describe, expect, it } from 'vitest'
import { isWorkspaceDueDateOverdue, localDateIso } from './workspace-due-date'

describe('workspace due date', () => {
  it('uses local calendar dates and marks only dates before today overdue', () => {
    expect(localDateIso(new Date(2026, 7, 9, 23, 30))).toBe('2026-08-09')
    expect(isWorkspaceDueDateOverdue('2026-08-08', '2026-08-09')).toBe(true)
    expect(isWorkspaceDueDateOverdue('2026-08-09', '2026-08-09')).toBe(false)
    expect(isWorkspaceDueDateOverdue('2026-08-10', '2026-08-09')).toBe(false)
    expect(isWorkspaceDueDateOverdue(null, '2026-08-09')).toBe(false)
  })
})
