import { BrowserWindow, dialog } from 'electron'
import type { LocalCommandRequest } from './hermes-local-command-protocol'

function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => JSON.stringify(arg))].join(' ')
}

async function showCommandApproval(commands: string[]): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    title: 'Allow local command?',
    message: 'Hermes wants to run commands on this computer.',
    detail: commands.join('\n\n'),
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
