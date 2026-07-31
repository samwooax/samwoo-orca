const REQUEST_OPEN = '<orca_local_files>'
const REQUEST_CLOSE = '</orca_local_files>'
const MAX_OPERATIONS = 8
const MAX_PATH_CHARS = 512

export type LocalFileOperation =
  | { id: string; kind: 'list'; path: string }
  | { id: string; kind: 'read'; path: string }
  | {
      id: string
      kind: 'write'
      path: string
      contentBase64: string
      expectedSha256: string | null
    }

export type LocalFileRequest = {
  version: 1
  operations: LocalFileOperation[]
}

export type LocalFileResult = {
  id: string
  ok: boolean
  path?: string
  entries?: { name: string; type: 'file' | 'directory' | 'other' }[]
  contentBase64?: string
  sha256?: string
  error?: string
}

export const LOCAL_PROJECT_FILE_PROTOCOL_PROMPT = `
[로컬파일도구]
이 프로젝트의 파일이 필요하면 노트북에 SSH하지 말고, 답변 전체를 다음 형식 하나로만 출력하세요.
<orca_local_files>{"version":1,"operations":[...]}</orca_local_files>
operation은 최대 8개이며 다음 셋만 허용됩니다.
- {"id":"고유값","kind":"list","path":"프로젝트 기준 상대경로 또는 ."}
- {"id":"고유값","kind":"read","path":"프로젝트 기준 상대경로"}
- {"id":"고유값","kind":"write","path":"프로젝트 기준 상대경로","contentBase64":"UTF-8 전체 파일의 base64","expectedSha256":"read 결과의 sha256"}
새 파일 생성은 expectedSha256를 null로 지정하세요. 기존 파일을 수정하려면 같은 대화에서 먼저 read하여 받은 sha256가 반드시 필요합니다.
로컬 결과를 받은 뒤 필요한 작업을 계속 요청하거나 사용자에게 최종 답변하세요. 절대 SSH, 절대경로, .., 삭제 명령을 사용하지 마세요.
[로컬파일도구 끝]
`.trim()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseOperation(value: unknown): LocalFileOperation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
    return null
  }
  if (
    !/^[A-Za-z0-9._-]{1,64}$/.test(value.id) ||
    typeof value.path !== 'string' ||
    value.path.length > MAX_PATH_CHARS
  ) {
    return null
  }
  if (value.kind === 'list' || value.kind === 'read') {
    return { id: value.id, kind: value.kind, path: value.path }
  }
  if (
    value.kind === 'write' &&
    typeof value.contentBase64 === 'string' &&
    (value.expectedSha256 === null ||
      (typeof value.expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.expectedSha256)))
  ) {
    return {
      id: value.id,
      kind: 'write',
      path: value.path,
      contentBase64: value.contentBase64,
      expectedSha256: value.expectedSha256
    }
  }
  return null
}

export function parseLocalFileRequest(reply: string): LocalFileRequest | null {
  const trimmed = reply.trim()
  if (!trimmed.startsWith(REQUEST_OPEN) || !trimmed.endsWith(REQUEST_CLOSE)) {
    return null
  }
  const json = trimmed.slice(REQUEST_OPEN.length, -REQUEST_CLOSE.length)
  try {
    const value = JSON.parse(json) as unknown
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
    const typedOperations = operations as LocalFileOperation[]
    if (new Set(typedOperations.map((operation) => operation.id)).size !== operations.length) {
      return null
    }
    return { version: 1, operations: typedOperations }
  } catch {
    return null
  }
}

export function formatLocalFileResults(results: LocalFileResult[]): string {
  return `<orca_local_file_results>${JSON.stringify({ version: 1, results })}</orca_local_file_results>`
}
