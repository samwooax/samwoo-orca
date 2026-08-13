export type TeamChatLocalToolOperationResult = {
  id: string
  kind:
    | 'list'
    | 'read'
    | 'write'
    | 'inspect'
    | 'extract'
    | 'apply_xlsx_translation'
    | 'apply_pptx_translation'
    | 'create_pptx'
    | 'edit_pptx'
    | 'create_pdf'
    | 'edit_pdf'
    | 'create'
    | 'modify'
    | 'validate'
    | 'render'
    | 'cancel'
    | 'run'
    | 'stop'
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
  kind: 'local_file' | 'local_document' | 'local_command' | 'excel_artifact'
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
