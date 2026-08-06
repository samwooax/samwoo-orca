import { describe, expect, it } from 'vitest'
import { resolveQuitAndInstallFlags } from './updater-install-flags'

describe('resolveQuitAndInstallFlags', () => {
  it('installs Windows updates silently and relaunches the app', () => {
    expect(resolveQuitAndInstallFlags('win32', false)).toEqual({
      isSilent: true,
      isForceRunAfter: true
    })
  })

  it('preserves the existing interactive install on other desktop platforms', () => {
    expect(resolveQuitAndInstallFlags('linux', false)).toEqual({
      isSilent: false,
      isForceRunAfter: true
    })
  })

  it('leaves relaunch ownership with a headless serve supervisor', () => {
    expect(resolveQuitAndInstallFlags('win32', true)).toEqual({
      isSilent: true,
      isForceRunAfter: false
    })
  })
})
