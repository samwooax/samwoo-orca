export const TEAM_CHAT_PROGRESS_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed'
] as const

export type TeamChatProgressStatus = (typeof TEAM_CHAT_PROGRESS_STATUSES)[number]
export type TeamChatProgressKind =
  | 'phase'
  | 'thought'
  | 'plan'
  | 'tool'
  | 'local_file'
  | 'local_command'

export type TeamChatProgressEvent = {
  requestId: string
  id: string
  kind: TeamChatProgressKind
  title: string
  detail?: string
  status: TeamChatProgressStatus
}
