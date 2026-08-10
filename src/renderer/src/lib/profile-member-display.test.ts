import { describe, expect, it } from 'vitest'
import {
  profileMemberDisplayName,
  profileMemberInitial,
  profileMemberNameMap
} from './profile-member-display'

describe('profile member display', () => {
  const members = new Map([
    ['alpha', '멤버 이름'],
    ['beta', 'Beta Member']
  ])

  it('prefers a response display name over the member directory', () => {
    expect(profileMemberDisplayName('alpha', '응답 이름', members)).toBe('응답 이름')
  })

  it('falls back through the member directory to login', () => {
    expect(profileMemberDisplayName('alpha', null, members)).toBe('멤버 이름')
    expect(profileMemberDisplayName('unknown', undefined, members)).toBe('unknown')
  })

  it('uses the first Unicode character of the resolved name', () => {
    expect(profileMemberInitial('alpha', null, members)).toBe('멤')
    expect(profileMemberInitial('beta', null, members)).toBe('B')
  })

  it('builds a canonical name directory for workspace audit identities', () => {
    const directory = profileMemberNameMap([{ login: 'ALPHA@Company.Test', name: '김동훈' }])

    expect(profileMemberDisplayName('alpha', undefined, directory)).toBe('김동훈')
  })
})
