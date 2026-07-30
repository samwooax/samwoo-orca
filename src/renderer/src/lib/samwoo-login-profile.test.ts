import { describe, expect, it } from 'vitest'
import { resolveSamwooLoginProfile } from './samwoo-login-profile'

describe('resolveSamwooLoginProfile', () => {
  it('prefers the explicit Hermes profile over the legacy role', () => {
    expect(resolveSamwooLoginProfile({ profile: 'ai_center', role: 'oliver' })).toBe('ai_center')
  })

  it('falls back to the legacy role for older auth responses', () => {
    expect(resolveSamwooLoginProfile({ role: 'hr' })).toBe('hr')
  })

  it('ignores blank profile values', () => {
    expect(resolveSamwooLoginProfile({ profile: '  ', role: 'planning' })).toBe('planning')
    expect(resolveSamwooLoginProfile({ profile: null, role: null })).toBeNull()
  })
})
