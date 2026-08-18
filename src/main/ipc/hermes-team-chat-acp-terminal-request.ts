import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'

const DEFAULT_FOREGROUND_TIMEOUT_SECONDS = 120
const FORMAT_CONTROL_RE = /\p{Cf}/u
const MAX_COMMAND_CHARS = 8_000
const MAX_FOREGROUND_TIMEOUT_SECONDS = 120
const TERMINAL_ID_RE = /^[0-9a-f-]{36}$/

export type HermesAcpTerminalCreateRequest = {
  background: boolean
  command: string
  outputByteLimit: unknown
  timeoutSeconds: number
  virtualCwd: string
}

function requiredString(params: AcpJsonRecord, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`ACP terminal ${key} is required`)
  }
  return value
}

function hasUnsafeCommandControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    const disallowedC0 =
      codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d
    if (disallowedC0 || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true
    }
  }
  return false
}

export function parseHermesAcpTerminalCreateRequest(
  params: AcpJsonRecord
): HermesAcpTerminalCreateRequest {
  const command = requiredString(params, 'command').trim()
  if (
    !command ||
    command.length > MAX_COMMAND_CHARS ||
    hasUnsafeCommandControl(command) ||
    FORMAT_CONTROL_RE.test(command)
  ) {
    throw new Error('ACP terminal command is invalid')
  }
  const hasArguments =
    params.args != null && (!Array.isArray(params.args) || params.args.length > 0)
  const hasEnvironment = params.env != null && (!Array.isArray(params.env) || params.env.length > 0)
  if (hasArguments || hasEnvironment) {
    throw new Error('ACP terminal arguments or environment are not supported')
  }
  const meta = isAcpRecord(params._meta) ? params._meta : null
  const samwoo = meta && isAcpRecord(meta.samwoo) ? meta.samwoo : null
  if (!samwoo || samwoo.shellText !== true) {
    throw new Error('ACP terminal request did not come from the local bridge')
  }
  const timeout = samwoo.timeoutSeconds
  const timeoutSeconds = Number.isSafeInteger(timeout)
    ? Math.max(1, Math.min(MAX_FOREGROUND_TIMEOUT_SECONDS, Number(timeout)))
    : DEFAULT_FOREGROUND_TIMEOUT_SECONDS
  return {
    background: samwoo.background === true,
    command,
    outputByteLimit: params.outputByteLimit,
    timeoutSeconds,
    virtualCwd: typeof params.cwd === 'string' ? params.cwd : '/workspace'
  }
}

export function requireHermesAcpTerminalId(params: AcpJsonRecord): string {
  const id = requiredString(params, 'terminalId')
  if (!TERMINAL_ID_RE.test(id)) {
    throw new Error('ACP terminal id is invalid')
  }
  return id
}
