import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readSharedWorkspaceAlias, writeSharedWorkspaceAlias } from './shared-workspace-alias-store'

describe('shared workspace local aliases', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    })
  })

  it('keeps aliases separate per signed-in employee', () => {
    writeSharedWorkspaceAlias('employee-a', 'share-1', '내 작업명')

    expect(readSharedWorkspaceAlias('employee-a', 'share-1')).toBe('내 작업명')
    expect(readSharedWorkspaceAlias('employee-b', 'share-1')).toBe('')
  })

  it('removes an alias when the value is cleared', () => {
    writeSharedWorkspaceAlias('employee-a', 'share-1', '별칭')
    writeSharedWorkspaceAlias('employee-a', 'share-1', '  ')

    expect(readSharedWorkspaceAlias('employee-a', 'share-1')).toBe('')
  })
})
