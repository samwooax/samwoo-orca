import { describe, expect, it } from 'vitest'
import {
  formatDirectShellCommandReply,
  parseDirectShellCommand
} from './hermes-team-chat-local-command'

describe('parseDirectShellCommand', () => {
  it('recognizes a command only when ! is the first non-whitespace character', () => {
    expect(parseDirectShellCommand('!git status')).toBe('git status')
    expect(parseDirectShellCommand('  ! npm test  ')).toBe('npm test')
    expect(parseDirectShellCommand('please !git status')).toBeNull()
    expect(parseDirectShellCommand('!')).toBeNull()
  })
})

describe('formatDirectShellCommandReply', () => {
  it('keeps terminal output in a fenced block and reports failures', () => {
    const reply = formatDirectShellCommandReply('git status', {
      ok: false,
      status: 'completed',
      exitCode: 1,
      output: 'fatal: not a repository',
      error: 'command exited with code 1'
    })
    expect(reply).toContain('Command failed (exit code 1)')
    expect(reply).toContain('fatal: not a repository')
    expect(reply).toContain('command exited with code 1')
  })
})
