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

  it('grants no-prompt terminal access for unsupported file operations', () => {
    const context = formatHermesAcpLocalFilesContext(true)

    expect(context).toContain('without a per-command approval dialog')
    expect(context).toContain('deletion, moves, renames, search')
    expect(context).toContain('use the terminal instead')
  })

  it('explains paginated visual Office previews', () => {
    const context = formatHermesAcpLocalFilesContext(true)

    expect(context).toContain('XLSX and PPTX')
    expect(context).toContain('rendered visual preview')
    expect(context).toContain('limit selects up to 4')
  })

  it('routes spreadsheet changes through the bundled Excel worker when available', () => {
    const context = formatHermesAcpLocalFilesContext(true, true)

    expect(context).toContain('Excel Artifact v1 envelope')
    expect(context).toContain('bundled local openpyxl and XlsxWriter')
    expect(context).toContain('attached document block')
    expect(context).toContain('project XLSX read_file preview')
    expect(context).toContain('Do not use terminal Python')
    expect(context).toContain('the only exception')
  })
})
