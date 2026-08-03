export const TEAM_CHAT_MODELS = [
  {
    id: 'fable',
    label: 'Fable 5',
    provider: 'claude',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    id: 'opus',
    label: 'Opus 4.8',
    provider: 'claude',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max']
  },
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    provider: 'hermes',
    efforts: []
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    provider: 'hermes',
    efforts: []
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    provider: 'hermes',
    efforts: []
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    provider: 'hermes',
    efforts: []
  }
] as const

export type TeamChatModelId = (typeof TEAM_CHAT_MODELS)[number]['id']
export type TeamChatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type TeamChatHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
}

const MODEL_BY_ID = new Map(TEAM_CHAT_MODELS.map((model) => [model.id, model]))
const MAX_HISTORY_MESSAGES = 24
const MAX_HISTORY_CHARS = 48_000
export const TEAM_CHAT_MESSAGE_TIMEOUT_MS = 30 * 60_000
const REMOTE_MESSAGE_TIMEOUT_SECONDS = TEAM_CHAT_MESSAGE_TIMEOUT_MS / 1000

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function teamChatRunFile(requestId: string): string {
  return `/tmp/samwoo-team-chat-${requestId}.pid`
}

function wrapTeamChatSession(requestId: string, agentCommand: string): string {
  const runFile = teamChatRunFile(requestId)
  const sessionScript = [
    `run_file=${shellQuote(runFile)}`,
    'cleanup() { rm -f "$run_file"; }',
    'trap cleanup EXIT',
    'printf "%s\\n" "$$" > "$run_file"',
    `timeout --signal=TERM --kill-after=5s ${REMOTE_MESSAGE_TIMEOUT_SECONDS}s ${agentCommand}`
  ].join('; ')
  return `setsid sh -c ${shellQuote(sessionScript)}`
}

export function resolveTeamChatModel(id: unknown) {
  return MODEL_BY_ID.get(String(id) as TeamChatModelId) ?? MODEL_BY_ID.get('gpt-5.5')!
}

export function resolveTeamChatEffort(modelId: TeamChatModelId, effort: unknown): TeamChatEffort {
  const model = resolveTeamChatModel(modelId)
  const requested = String(effort)
  return model.efforts.some((value) => value === requested)
    ? (requested as TeamChatEffort)
    : 'medium'
}

export function normalizeTeamChatHistory(value: unknown): TeamChatHistoryMessage[] {
  if (!Array.isArray(value)) {
    return []
  }
  const normalized = value
    .filter(
      (item): item is TeamChatHistoryMessage =>
        item !== null &&
        typeof item === 'object' &&
        ((item as TeamChatHistoryMessage).role === 'user' ||
          (item as TeamChatHistoryMessage).role === 'assistant') &&
        typeof (item as TeamChatHistoryMessage).content === 'string'
    )
    .map((item) => ({
      role: item.role,
      content: item.content.slice(0, 12_000)
    }))
    .filter((item) => item.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)

  let total = 0
  const kept: TeamChatHistoryMessage[] = []
  for (const item of normalized.toReversed()) {
    if (total + item.content.length > MAX_HISTORY_CHARS) {
      break
    }
    total += item.content.length
    kept.push(item)
  }
  return kept.toReversed()
}

export function formatTeamChatMessage(args: {
  message: string
  history: TeamChatHistoryMessage[]
  contextLine?: string
}): string {
  const transcript = args.history
    .map((item) => `${item.role === 'user' ? '사용자' : '에이전트'}:\n${item.content}`)
    .join('\n\n')
  const historyBlock = transcript ? `[이전 대화]\n${transcript}\n[이전 대화 끝]\n\n` : ''
  return `${args.contextLine ?? ''}${historyBlock}사용자:\n${args.message}`
}

export function buildTeamChatRemoteCommand(args: {
  requestId: string
  profile: string
  modelId: TeamChatModelId
  effort: TeamChatEffort
  mailToken?: string
}): string {
  const model = resolveTeamChatModel(args.modelId)
  const profileHome = `/opt/data/profiles/${args.profile}`
  const mailEnv = args.mailToken ? `MAILTOKEN=${args.mailToken} ` : ''
  let agentCommand: string
  if (model.provider === 'claude') {
    const profilePrompt =
      '$(cat SOUL.md; printf "\\n\\n필요한 업무 도구는 이 프로필의 skills/*/SKILL.md 지침을 먼저 읽고 사용하세요.")'
    agentCommand =
      `sh -lc 'cd ${profileHome} && ${mailEnv}claude -p --model ${model.id} ` +
      `--effort ${args.effort} --permission-mode bypassPermissions ` +
      `--dangerously-skip-permissions --output-format stream-json --verbose ` +
      `--append-system-prompt "${profilePrompt}" "$(cat)"'`
  } else {
    agentCommand =
      `sh -lc 'cd ${profileHome} && ${mailEnv}HERMES_HOME=${profileHome} hermes ` +
      `--model ${model.id} -z "$(cat)" --cli'`
  }

  // Why: the SSH client can disappear without terminating remote descendants; a dedicated session gives cancellation a verifiable boundary.
  return wrapTeamChatSession(args.requestId, agentCommand)
}

export function buildTeamChatAcpRemoteCommand(args: {
  requestId: string
  profile: string
  mailToken?: string
}): string {
  const profileHome = `/opt/data/profiles/${args.profile}`
  const mailEnv = args.mailToken ? `MAILTOKEN=${args.mailToken} ` : ''
  const command =
    `sh -lc 'cd ${profileHome} && ${mailEnv}HERMES_HOME=${profileHome} ` + `hermes acp'`
  return wrapTeamChatSession(args.requestId, command)
}

export function buildTeamChatCancelRemoteCommand(requestId: string): string {
  const runFile = teamChatRunFile(requestId)
  // Why: TERM allows cleanup, while KILL prevents an uncooperative tool from surviving the confirmed stop.
  const script = [
    `run_file=${shellQuote(runFile)}`,
    'attempt=0',
    'while [ ! -s "$run_file" ] && [ "$attempt" -lt 20 ]; do sleep 0.1; attempt=$((attempt + 1)); done',
    '[ -s "$run_file" ] || exit 3',
    'sid=$(cat "$run_file")',
    `case "$sid" in ''|*[!0-9]*) exit 4 ;; esac`,
    'pkill -TERM -s "$sid" 2>/dev/null || true',
    'attempt=0',
    'while pgrep -s "$sid" >/dev/null 2>&1 && [ "$attempt" -lt 20 ]; do sleep 0.25; attempt=$((attempt + 1)); done',
    'if pgrep -s "$sid" >/dev/null 2>&1; then pkill -KILL -s "$sid" 2>/dev/null || true; sleep 0.25; fi',
    'pgrep -s "$sid" >/dev/null 2>&1 && exit 5',
    'rm -f "$run_file"',
    'printf stopped'
  ].join('; ')
  return `sh -c ${shellQuote(script)}`
}
