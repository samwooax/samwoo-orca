export type TeamChatLocalToolOperationResult = {
  id: string
  kind: 'list' | 'read' | 'write' | 'run' | 'stop'
  ok: boolean
  target?: string
  status?: 'completed' | 'running' | 'stopped'
  exitCode?: number | null
  processId?: string
  url?: string
  sha256?: string
  error?: string
}

export type TeamChatLocalToolExecution = {
  sequence: number
  kind: 'local_file' | 'local_command'
  operations: TeamChatLocalToolOperationResult[]
}

export type HermesTeamChatErrorCode = 'local_tool_protocol_invalid' | 'local_tool_limit_exceeded'

export type HermesTeamChatResult = {
  ok: boolean
  reply?: string
  error?: string
  errorCode?: HermesTeamChatErrorCode
  toolExecutions?: TeamChatLocalToolExecution[]
}
