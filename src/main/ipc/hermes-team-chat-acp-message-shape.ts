import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'

const MAX_METHOD_BYTES = 128
export const MAX_ACP_REQUEST_ID_BYTES = 256

export type HermesAcpMessageKind = 'notification' | 'request' | 'response'

export function isHermesAcpRequestId(value: unknown): value is string | number {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value)
  }
  return typeof value === 'string' && Buffer.byteLength(value) <= MAX_ACP_REQUEST_ID_BYTES
}

export function classifyHermesAcpMessage(message: AcpJsonRecord): HermesAcpMessageKind | null {
  if (message.jsonrpc !== '2.0') {
    return null
  }
  const hasMethod = Object.hasOwn(message, 'method')
  const hasResult = Object.hasOwn(message, 'result')
  const hasError = Object.hasOwn(message, 'error')
  if (hasMethod) {
    if (
      typeof message.method !== 'string' ||
      !message.method ||
      Buffer.byteLength(message.method) > MAX_METHOD_BYTES ||
      hasResult ||
      hasError ||
      (Object.hasOwn(message, 'params') && !isAcpRecord(message.params))
    ) {
      return null
    }
    if (!Object.hasOwn(message, 'id')) {
      return 'notification'
    }
    return isHermesAcpRequestId(message.id) ? 'request' : null
  }
  if (
    Object.hasOwn(message, 'params') ||
    !Object.hasOwn(message, 'id') ||
    !isHermesAcpRequestId(message.id) ||
    hasResult === hasError
  ) {
    return null
  }
  if (
    hasError &&
    (!isAcpRecord(message.error) ||
      !Number.isSafeInteger(message.error.code) ||
      typeof message.error.message !== 'string')
  ) {
    return null
  }
  return 'response'
}
