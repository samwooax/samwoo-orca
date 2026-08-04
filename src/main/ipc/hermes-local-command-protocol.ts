const REQUEST_OPEN = '<orca_local_commands>'
const REQUEST_CLOSE = '</orca_local_commands>'
const MAX_OPERATIONS = 4
const MAX_ARGS = 64
const MAX_ARG_CHARS = 1_024
const MAX_TOTAL_ARG_CHARS = 8_192

const ALLOWED_COMMANDS = new Set([
  'bun',
  'node',
  'npm',
  'npx',
  'pnpm',
  'py',
  'python',
  'python3',
  'streamlit',
  'uv',
  'yarn'
])

export type LocalCommandOperation =
  | {
      id: string
      kind: 'run'
      command: string
      args: string[]
      mode: 'foreground' | 'background'
      timeoutSeconds?: number
    }
  | { id: string; kind: 'stop'; processId: string }

export type LocalCommandRequest = {
  version: 1
  operations: LocalCommandOperation[]
}

export type LocalCommandResult = {
  id: string
  ok: boolean
  status?: 'completed' | 'running' | 'stopped'
  exitCode?: number | null
  processId?: string
  url?: string
  output?: string
  error?: string
}

export const LOCAL_PROJECT_COMMAND_PROTOCOL_PROMPT = `
[로컬명령도구]
사용자가 선택한 프로젝트의 결과물 실행·테스트·의존성 설치를 명시적으로 요청했을 때만, 답변 전체를 다음 형식 하나로 출력하세요.
<orca_local_commands>{"version":1,"operations":[...]}</orca_local_commands>
operation은 최대 4개이며 다음 둘만 허용됩니다.
- 실행: {"id":"고유값","kind":"run","command":"uv","args":["run","python","app.py"],"mode":"foreground","timeoutSeconds":120}
- 중지: {"id":"고유값","kind":"stop","processId":"이전 실행 결과의 processId"}
command는 uv, python, python3, py, streamlit, node, npm, npx, pnpm, yarn, bun 중 하나만 사용하세요. 셸 연산자나 명령 문자열을 args에 넣지 마세요.
Streamlit 서버는 background로 실행하세요. requirements.txt가 있으면 권장 형식은 command=uv, args=["run","--with-requirements","requirements.txt","--with","streamlit","streamlit","run","app.py"], mode=background 입니다.
일반 Python 파일은 command=uv, args=["run","python","파일.py"]를 우선 사용하세요. 테스트·설치처럼 끝나는 작업은 foreground, 웹 서버처럼 계속 실행되는 작업은 background를 사용하세요.
사용자가 실행을 명시하지 않았다면 명령을 요청하지 말고 무엇을 실행할지 확인하세요. 노트북에 SSH하지 말고 반드시 이 도구만 사용하세요.
[로컬명령도구 끝]
`.trim()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value)
}

function parseRun(value: Record<string, unknown>): LocalCommandOperation | null {
  if (
    !validId(value.id) ||
    typeof value.command !== 'string' ||
    !ALLOWED_COMMANDS.has(value.command) ||
    !Array.isArray(value.args) ||
    value.args.length > MAX_ARGS ||
    !value.args.every((arg) => typeof arg === 'string' && arg.length <= MAX_ARG_CHARS) ||
    value.args.reduce((total, arg) => total + String(arg).length, 0) > MAX_TOTAL_ARG_CHARS ||
    (value.mode !== 'foreground' && value.mode !== 'background')
  ) {
    return null
  }
  if (
    value.timeoutSeconds !== undefined &&
    (!Number.isInteger(value.timeoutSeconds) ||
      Number(value.timeoutSeconds) < 1 ||
      Number(value.timeoutSeconds) > 600)
  ) {
    return null
  }
  return {
    id: value.id,
    kind: 'run',
    command: value.command,
    args: value.args as string[],
    mode: value.mode,
    ...(value.timeoutSeconds === undefined ? {} : { timeoutSeconds: Number(value.timeoutSeconds) })
  }
}

function parseOperation(value: unknown): LocalCommandOperation | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return null
  }
  if (value.kind === 'run') {
    return parseRun(value)
  }
  if (
    value.kind === 'stop' &&
    validId(value.id) &&
    typeof value.processId === 'string' &&
    /^[A-Za-z0-9-]{1,80}$/.test(value.processId)
  ) {
    return { id: value.id, kind: 'stop', processId: value.processId }
  }
  return null
}

export function parseLocalCommandRequest(reply: string): LocalCommandRequest | null {
  const trimmed = reply.trim()
  if (!trimmed.startsWith(REQUEST_OPEN) || !trimmed.endsWith(REQUEST_CLOSE)) {
    return null
  }
  try {
    const value = JSON.parse(trimmed.slice(REQUEST_OPEN.length, -REQUEST_CLOSE.length)) as unknown
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.operations) ||
      value.operations.length === 0 ||
      value.operations.length > MAX_OPERATIONS
    ) {
      return null
    }
    const operations = value.operations.map(parseOperation)
    if (operations.some((operation) => operation === null)) {
      return null
    }
    const typed = operations as LocalCommandOperation[]
    if (new Set(typed.map((operation) => operation.id)).size !== typed.length) {
      return null
    }
    return { version: 1, operations: typed }
  } catch {
    return null
  }
}

export function formatLocalCommandResults(results: LocalCommandResult[]): string {
  return `<orca_local_command_results>${JSON.stringify({ version: 1, results })}</orca_local_command_results>`
}
