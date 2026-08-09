import { describe, expect, it } from 'vitest'
import { canonicalSamwooLogin } from './samwoo-login-identity'

describe('canonicalSamwooLogin', () => {
  it.each([
    [' Member@Company.Test ', 'member'],
    ['MEMBER', 'member'],
    [' member ', 'member'],
    ['', '']
  ])('normalizes %j to %j', (input, expected) => {
    expect(canonicalSamwooLogin(input)).toBe(expected)
  })
})
