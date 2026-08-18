import { BrowserWindow, dialog } from 'electron'
import type { LocalCommandRequest } from './hermes-local-command-protocol'

const FORMAT_CONTROL_RE = /\p{Cf}/u

function visibleApprovalText(value: string): string {
  let visible = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (character === '\\') {
      visible += '\\\\'
    } else if (character === '\n') {
      visible += '\\n'
    } else if (character === '\r') {
      visible += '\\r'
    } else if (character === '\t') {
      visible += '\\t'
    } else if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      FORMAT_CONTROL_RE.test(character)
    ) {
      visible += `\\u{${codePoint.toString(16)}}`
    } else {
      visible += character
    }
  }
  return visible
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => JSON.stringify(arg))].join(' ')
}

async function showCommandApproval(commands: string[], warning?: string): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    title: 'Allow local command?',
    message: 'Hermes wants to run commands on this computer.',
    detail: [warning, ...commands].filter(Boolean).join('\n\n'),
    buttons: ['Allow once', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const parent = BrowserWindow.getFocusedWindow()
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

export async function approveLocalCommandRequest(request: LocalCommandRequest): Promise<boolean> {
  const commands = request.operations
    .filter((operation) => operation.kind === 'run')
    .map((operation) => formatCommand(operation.command, operation.args))
  return commands.length === 0 ? true : showCommandApproval(commands)
}

export async function approveLocalShellCommand(command: string): Promise<boolean> {
  return showCommandApproval([command])
}

export async function approveHermesAcpTerminalCommand(
  command: string,
  cwd?: string
): Promise<boolean> {
  return showCommandApproval(
    [
      [
        cwd ? `Working directory:\n${visibleApprovalText(cwd)}` : '',
        `Command:\n${visibleApprovalText(command)}`
      ]
        .filter(Boolean)
        .join('\n\n')
    ],
    'This command is not sandboxed. It can access files outside the project and the network, bypass file backups, and return its output to Hermes. Approval expires after 45 seconds.'
  )
}
