import { describe, expect, it } from 'vitest'
import { buildNativeChatFileReferenceInsertion } from './native-chat-file-reference'

describe('buildNativeChatFileReferenceInsertion', () => {
  it('inserts a project-relative reference into an empty composer', () => {
    expect(
      buildNativeChatFileReferenceInsertion({
        draft: '',
        selectionStart: 0,
        selectionEnd: 0,
        relativePath: 'src/server.ts'
      })
    ).toBe('@src/server.ts ')
  })

  it('keeps the reference separated from text around the caret', () => {
    expect(
      buildNativeChatFileReferenceInsertion({
        draft: 'Please editthis file',
        selectionStart: 11,
        selectionEnd: 11,
        relativePath: 'src/server.ts'
      })
    ).toBe(' @src/server.ts ')
  })

  it('normalizes Windows separators for agent-readable references', () => {
    expect(
      buildNativeChatFileReferenceInsertion({
        draft: '',
        selectionStart: 0,
        selectionEnd: 0,
        relativePath: 'src\\server.ts'
      })
    ).toBe('@src/server.ts ')
  })
})
