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

export function formatHermesAcpLocalFilesContext(localTerminal: boolean): string {
  return [
    '[Local project tools]',
    'Use the native read_file, write_file, and patch tools for files under /workspace.',
    'ACP file-tool access is served by Orca and restricted to the selected project root.',
    'For XLSX and PPTX files, read_file returns a rendered visual preview instead of text; offset selects the first page or slide and limit selects up to 4.',
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
    'Do not emit Orca envelope tags.',
    ''
  ].join('\n')
}
