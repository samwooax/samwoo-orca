import type { TeamChatDeviceContext } from './hermes-team-chat-device-context'
import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'

export const HERMES_ACP_CAPABILITY_PROBE_ENV = 'SAMWOO_HERMES_ACP_CAPABILITY_PROBE'

export type HermesAcpCapabilityProbeMode = 'fs' | 'terminal'

export type HermesAcpCapabilityProbe = {
  mode: HermesAcpCapabilityProbeMode
  clientCapabilities: AcpJsonRecord
  sessionCwd: string
}

type ProbeLogDirection = 'client_to_agent' | 'agent_to_client'
export type HermesAcpCapabilityProbeLogger = (
  direction: ProbeLogDirection,
  message: AcpJsonRecord,
  responseTo?: string
) => void

const CLIENT_METHOD_PREFIXES = ['fs/', 'terminal/'] as const
const SAFE_METHOD_RE = /^[A-Za-z][A-Za-z0-9_./-]{0,79}$/
const SAFE_CAPABILITY_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const MAX_CAPABILITY_LOG_NODES = 128
const LOGGED_ACP_METHODS = new Set([
  'fs/read_text_file',
  'fs/write_text_file',
  'initialize',
  'session/cancel',
  'session/new',
  'session/prompt',
  'session/request_permission',
  'session/set_config_option',
  'session/set_model',
  'session/update',
  'terminal/create',
  'terminal/kill',
  'terminal/output',
  'terminal/release',
  'terminal/wait_for_exit'
])
const ALLOWED_CAPABILITY_LOG_FIELDS = new Set([
  'additionalDirectories',
  'audio',
  'auth',
  'delete',
  'embeddedContext',
  'fork',
  'fs',
  'http',
  'image',
  'list',
  'loadSession',
  'logout',
  'mcpCapabilities',
  'promptCapabilities',
  'readTextFile',
  'resume',
  'sessionCapabilities',
  'sse',
  'terminal',
  'writeTextFile'
])
const OMITTED_LOG_FIELDS = new Set([
  '_meta',
  'args',
  'command',
  'content',
  'cwd',
  'env',
  'locations',
  'path',
  'prompt',
  'rawinput',
  'rawoutput',
  'sessionid',
  'text',
  'token'
])

export function resolveHermesAcpCapabilityProbe(args: {
  profile: string
  isDevelopment: boolean
  requestedMode?: string
  sessionCwd?: string
}): HermesAcpCapabilityProbe | null {
  if (!args.isDevelopment || args.profile !== 'ai_center' || !args.sessionCwd?.trim()) {
    return null
  }
  if (args.requestedMode === 'fs') {
    return {
      mode: 'fs',
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      sessionCwd: args.sessionCwd
    }
  }
  if (args.requestedMode === 'terminal') {
    return {
      mode: 'terminal',
      clientCapabilities: { terminal: true },
      sessionCwd: args.sessionCwd
    }
  }
  return null
}

export function formatHermesAcpCapabilityProbeContext(
  context: TeamChatDeviceContext,
  mode: HermesAcpCapabilityProbeMode
): string {
  const instruction =
    mode === 'fs'
      ? '질문에 필요한 로컬 프로젝트 파일은 ACP 클라이언트의 native file 도구로 읽기만 요청하세요.'
      : '질문에 필요한 확인은 ACP 클라이언트의 native terminal 도구로 읽기 전용 명령 한 번만 요청하세요.'
  return [
    `[작업컨텍스트] ${JSON.stringify(context)}`,
    `[ACP capability 검증] mode=${mode}`,
    instruction,
    'Orca 커스텀 envelope나 서버 자체 도구로 우회하지 마세요.',
    '파일 쓰기, 상태 변경 명령, 네트워크 접근은 요청하지 마세요.',
    '해당 ACP 클라이언트 도구가 보이지 않으면 사용할 수 없다고 답하세요.',
    ''
  ].join('\n')
}

export function isHermesAcpClientMethod(method: unknown): method is string {
  return (
    typeof method === 'string' && CLIENT_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))
  )
}

export function hasOrcaToolEnvelope(reply: string): boolean {
  return /<\/?orca_[A-Za-z0-9_]+>/.test(reply)
}

function boundedCapabilityValue(value: unknown, budget: { remaining: number }, depth = 0): unknown {
  if (budget.remaining <= 0) {
    return '[truncated]'
  }
  budget.remaining -= 1
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) {
    return value
  }
  if (typeof value === 'string') {
    return '[redacted-string]'
  }
  if (depth >= 4) {
    return '[truncated]'
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => boundedCapabilityValue(item, budget, depth + 1))
  }
  if (!isAcpRecord(value)) {
    return undefined
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          SAFE_CAPABILITY_KEY_RE.test(key) &&
          ALLOWED_CAPABILITY_LOG_FIELDS.has(key) &&
          !OMITTED_LOG_FIELDS.has(key.toLowerCase())
      )
      .slice(0, 16)
      .map(([key, item]) => [key, boundedCapabilityValue(item, budget, depth + 1)])
      .filter((entry) => entry[1] !== undefined)
  )
}

function safeMethod(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_METHOD_RE.test(value) && LOGGED_ACP_METHODS.has(value)
    ? value
    : undefined
}

function safeProtocolVersion(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

export function formatHermesAcpCapabilityProbeLog(args: {
  direction: ProbeLogDirection
  profile: string
  mode: HermesAcpCapabilityProbeMode
  message: AcpJsonRecord
  responseTo?: string
}): string {
  const record: AcpJsonRecord = {
    scope: 'hermes_acp_capability_probe',
    direction: args.direction,
    profile: args.profile === 'ai_center' ? 'ai_center' : '[redacted]',
    mode: args.mode
  }
  if (typeof args.message.id === 'number' && Number.isSafeInteger(args.message.id)) {
    record.id = args.message.id
  } else if (typeof args.message.id === 'string') {
    record.idType = 'string'
  }
  const method = safeMethod(args.message.method)
  if (method) {
    record.method = method
  } else if (typeof args.message.method === 'string') {
    record.method = '[redacted]'
  }
  const responseTo = safeMethod(args.responseTo)
  if (responseTo) {
    record.responseTo = responseTo
  }
  if (args.message.method === 'initialize' && isAcpRecord(args.message.params)) {
    record.protocolVersion = safeProtocolVersion(args.message.params.protocolVersion)
    record.clientCapabilities = boundedCapabilityValue(args.message.params.clientCapabilities, {
      remaining: MAX_CAPABILITY_LOG_NODES
    })
  }
  if (args.responseTo === 'initialize' && isAcpRecord(args.message.result)) {
    record.protocolVersion = safeProtocolVersion(args.message.result.protocolVersion)
    record.agentCapabilities = boundedCapabilityValue(args.message.result.agentCapabilities, {
      remaining: MAX_CAPABILITY_LOG_NODES
    })
  }
  if (isAcpRecord(args.message.error) && typeof args.message.error.code === 'number') {
    record.errorCode = args.message.error.code
  }
  return JSON.stringify(record)
}

export function createHermesAcpCapabilityProbeLogger(args: {
  probe: HermesAcpCapabilityProbe | null
  profile: string
  log: (line: string) => void
}): HermesAcpCapabilityProbeLogger {
  return (direction, message, responseTo) => {
    if (!args.probe) {
      return
    }
    try {
      args.log(
        formatHermesAcpCapabilityProbeLog({
          direction,
          profile: args.profile,
          mode: args.probe.mode,
          message,
          responseTo
        })
      )
    } catch {
      // Why: diagnostic logging must never interrupt the ACP session.
    }
  }
}
