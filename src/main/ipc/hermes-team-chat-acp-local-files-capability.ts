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
    'Read an existing file before overwriting it.',
    ...(localTerminal
      ? [
          'Native terminal and process tools run on the user computer after explicit approval.',
          'Shell commands are unsandboxed: they may access outside /workspace and the network, and their writes bypass file-tool backups.',
          'Use /workspace only as terminal workdir; use paths relative to that workdir inside shell text. PTY input is unavailable.'
        ]
      : ['Local terminal and process execution are unavailable.']),
    'Do not emit Orca envelope tags.',
    ''
  ].join('\n')
}
