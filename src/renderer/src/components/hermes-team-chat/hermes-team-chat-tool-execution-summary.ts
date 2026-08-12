import type { TeamChatLocalToolExecution } from '../../../../shared/hermes-team-chat-result'

const MAX_DETAIL_CHARS = 240

function bounded(value: string): string {
  const singleLine = value.replaceAll(/[\r\n]+/g, ' ')
  return singleLine.length <= MAX_DETAIL_CHARS
    ? singleLine
    : `${singleLine.slice(0, MAX_DETAIL_CHARS - 1)}…`
}

export function formatTeamChatToolExecutionSummary(
  executions: TeamChatLocalToolExecution[] | undefined
): string {
  if (!executions?.length) {
    return ''
  }
  const lines = executions.flatMap((execution) =>
    execution.operations.map((operation) => {
      const target = operation.target ? ` · ${bounded(operation.target)}` : ''
      const error = operation.error ? ` · ${bounded(operation.error)}` : ''
      return `- ${operation.ok ? '성공' : '실패'}: ${operation.kind} (${operation.id})${target}${error}`
    })
  )
  return `실행된 로컬 작업:\n${lines.join('\n')}`
}
