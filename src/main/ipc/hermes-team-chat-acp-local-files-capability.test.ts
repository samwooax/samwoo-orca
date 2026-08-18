import { describe, expect, it } from 'vitest'
import {
  formatHermesAcpLocalFilesContext,
  resolveHermesAcpLocalFilesCapability
} from './hermes-team-chat-acp-local-files-capability'

describe('resolveHermesAcpLocalFilesCapability', () => {
  it('enables filesystem and terminal methods for the exact ai_center profile', () => {
    expect(
      resolveHermesAcpLocalFilesCapability({
        profile: 'ai_center',
        projectRoot: 'C:\\selected'
      })
    ).toEqual({
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true
      },
      localTerminal: true,
      projectRoot: 'C:\\selected'
    })
  })

  it.each([
    ['another profile', 'hr', 'C:\\selected'],
    ['similar profile', 'ai_center_backup', 'C:\\selected'],
    ['missing project', 'ai_center', '']
  ])('stays disabled for %s', (_label, profile, projectRoot) => {
    expect(
      resolveHermesAcpLocalFilesCapability({
        profile,
        projectRoot
      })
    ).toBeNull()
  })

  it('tells Hermes to create a confirmed-missing file directly', () => {
    const context = formatHermesAcpLocalFilesContext(true)

    expect(context).toContain('create a new file directly')
    expect(context).toContain('when a read reports that it does not exist')
  })
})
