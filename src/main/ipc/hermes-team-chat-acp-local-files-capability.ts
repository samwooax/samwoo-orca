import type { AcpJsonRecord } from './hermes-team-chat-acp-values'

export type HermesAcpLocalFilesCapability = {
  clientCapabilities: AcpJsonRecord
  localTerminal: boolean
  projectRoot: string
}

export function resolveHermesAcpLocalFilesCapability(args: {
  profile: string
  projectRoot?: string
}): HermesAcpLocalFilesCapability | null {
  if (args.profile !== 'ai_center' || !args.projectRoot?.trim()) {
    return null
  }
  return {
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true
    },
    localTerminal: true,
    projectRoot: args.projectRoot
  }
}

export function formatHermesAcpLocalFilesContext(
  localTerminal: boolean,
  excelArtifactAvailable = false
): string {
  return [
    '[Local project tools]',
    'Use the native read_file, write_file, and patch tools for files under /workspace.',
    'ACP file-tool access is served by Orca and restricted to the selected project root.',
    'For XLSX and PPTX files, read_file returns a rendered visual preview and source SHA-256 instead of text; offset selects the first page or slide and limit selects up to 4.',
    'Read an existing file before overwriting it; create a new file directly when a read reports that it does not exist.',
    ...(localTerminal
      ? [
          'Native terminal and process tools run on the user computer without a per-command approval dialog.',
          'Shell commands are unsandboxed: they may access outside /workspace and the network, and their writes bypass file-tool backups.',
          'Use terminal commands for deletion, moves, renames, search, and other operations not supported by read_file, write_file, or patch.',
          'Local search_files, execute_code, and apply-patch are unavailable; use the terminal instead.',
          'Use /workspace only as terminal workdir; use paths relative to that workdir inside shell text. PTY input is unavailable.'
        ]
      : ['Local terminal and process execution are unavailable.']),
    ...(excelArtifactAvailable
      ? [
          'For XLSX creation, editing, and validation, use only the Excel Artifact v1 envelope described above; it runs the bundled local openpyxl and XlsxWriter engines.',
          'Use the SHA-256 from an attached document block or a project XLSX read_file preview as the Excel input sha256.',
          'Do not use terminal Python, pip, package installation, or soffice for XLSX work.',
          'Do not emit Orca local file, document, or command envelopes; the Excel Artifact envelope is the only exception.'
        ]
      : ['Do not emit Orca envelope tags.']),
    ''
  ].join('\n')
}
