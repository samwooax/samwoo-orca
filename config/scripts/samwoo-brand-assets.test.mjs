import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const logo = readFileSync(new URL('../../resources/logo.svg', import.meta.url), 'utf8')

describe('SAMWOO brand assets', () => {
  it('keeps the wide SAMWOO wordmark used by the title bar and login gate', () => {
    expect(logo).toContain('viewBox="0 0 424.19 57.15"')
    expect(logo).toContain('fill="#8fc1ff"')
    expect(logo).not.toContain('viewBox="0 0 318.60232 202.66667"')
  })
})
