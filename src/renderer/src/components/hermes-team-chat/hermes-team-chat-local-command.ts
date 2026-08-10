export type HermesLocalShellCommandResult = {
  ok: boolean
  status?: 'completed' | 'cancelled'
  exitCode?: number | null
  output?: string
  error?: string
}

export function parseDirectShellCommand(message: string): string | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith('!')) {
    return null
  }
  const command = trimmed.slice(1).trim()
  return command || null
}

function codeFence(value: string): string {
  const longestFence = Math.max(2, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longestFence + 1)
  return `${fence}text\n${value}\n${fence}`
}

export function formatDirectShellCommandReply(
  command: string,
  result: HermesLocalShellCommandResult
): string {
  const status = result.ok
    ? 'Command completed'
    : result.status === 'cancelled'
      ? 'Command cancelled'
      : 'Command failed'
  const exitCode =
    result.exitCode === undefined ? '' : ` (exit code ${result.exitCode ?? 'unknown'})`
  const sections = [`${status}${exitCode}`, codeFence(`$ ${command}`)]
  if (result.output) {
    sections.push(codeFence(result.output))
  }
  if (result.error) {
    sections.push(`Error\n${codeFence(result.error)}`)
  }
  return sections.join('\n\n')
}
