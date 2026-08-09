import { describe, expect, it } from 'vitest'
import { hermesProfileLabel } from './start-agent-picker-store'

describe('hermesProfileLabel', () => {
  it('maps operational profile ids to the app display names', () => {
    expect(hermesProfileLabel('cs')).toBe('CS')
    expect(hermesProfileLabel('d_support')).toBe('대구영업지원')
    expect(hermesProfileLabel('support')).toBe('영업지원')
  })

  it('preserves unknown profile ids', () => {
    expect(hermesProfileLabel('custom_profile')).toBe('custom_profile')
  })
})
