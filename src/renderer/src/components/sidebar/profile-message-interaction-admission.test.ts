import { describe, expect, it } from 'vitest'
import {
  shouldApplyProfileMessageResponse,
  shouldMarkProfileMessagesRead,
  shouldSubmitProfileMessageKey
} from './profile-message-interaction-admission'

describe('profile message interaction admission', () => {
  it('rejects a response after the active channel changes', () => {
    expect(shouldApplyProfileMessageResponse('team', 'workspace:one')).toBe(false)
    expect(shouldApplyProfileMessageResponse('team', 'team')).toBe(true)
  })

  it('does not submit Enter while an IME composition or newline chord is active', () => {
    expect(
      shouldSubmitProfileMessageKey({ key: 'Enter', shiftKey: false, isComposing: true })
    ).toBe(false)
    expect(
      shouldSubmitProfileMessageKey({ key: 'Enter', shiftKey: true, isComposing: false })
    ).toBe(false)
    expect(
      shouldSubmitProfileMessageKey({ key: 'Enter', shiftKey: false, isComposing: false })
    ).toBe(true)
  })

  it('marks only a newly visible latest message while the window is focused', () => {
    expect(
      shouldMarkProfileMessagesRead({
        messageId: 'new',
        lastMarkedMessageId: 'old',
        isAtBottom: true,
        documentHasFocus: true
      })
    ).toBe(true)
    for (const rejected of [
      { lastMarkedMessageId: 'new', isAtBottom: true, documentHasFocus: true },
      { lastMarkedMessageId: 'old', isAtBottom: false, documentHasFocus: true },
      { lastMarkedMessageId: 'old', isAtBottom: true, documentHasFocus: false }
    ]) {
      expect(shouldMarkProfileMessagesRead({ messageId: 'new', ...rejected })).toBe(false)
    }
  })
})
