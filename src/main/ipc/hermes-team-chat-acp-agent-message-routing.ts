import type { HermesAcpCapabilityProbe } from './hermes-team-chat-acp-capability-probe'
import { isHermesAcpClientMethod } from './hermes-team-chat-acp-capability-probe'
import type { HermesAcpFilesystemRequestDispatcher } from './hermes-team-chat-acp-filesystem-dispatch'
import {
  isHermesAcpRequestId,
  type HermesAcpMessageKind
} from './hermes-team-chat-acp-message-shape'
import { hermesAcpPermissionResult } from './hermes-team-chat-acp-permission-response'
import type { HermesAcpTurnProgress } from './hermes-team-chat-acp-turn-progress'
import type { HermesAcpTerminalRequestDispatcher } from './hermes-team-chat-acp-terminal-dispatch'
import { isAcpRecord, type AcpJsonRecord } from './hermes-team-chat-acp-values'

type WriteAcpMessage = (message: AcpJsonRecord, responseTo?: string) => void

export function routeHermesAcpAgentMessage(args: {
  message: AcpJsonRecord
  kind: Exclude<HermesAcpMessageKind, 'response'>
  capabilityProbe: HermesAcpCapabilityProbe | null
  filesystemRequests: HermesAcpFilesystemRequestDispatcher | null
  terminalRequests: HermesAcpTerminalRequestDispatcher | null
  sessionId: string
  activeTurn: HermesAcpTurnProgress | null
  acceptingPromptMessages: boolean
  cancelRequested: boolean
  writeMessage: WriteAcpMessage
}): void {
  const { message, kind, filesystemRequests, terminalRequests } = args
  if (
    kind === 'request' &&
    filesystemRequests?.isSupportedMethod(message.method) &&
    isHermesAcpRequestId(message.id)
  ) {
    void filesystemRequests.dispatch(message, args.sessionId).then((response) => {
      args.writeMessage(response, String(message.method))
    })
    return
  }
  if (
    kind === 'request' &&
    terminalRequests?.isSupportedMethod(message.method) &&
    isHermesAcpRequestId(message.id)
  ) {
    void terminalRequests.dispatch(message, args.sessionId).then((response) => {
      args.writeMessage(response, String(message.method))
    })
    return
  }
  if (
    kind === 'request' &&
    args.capabilityProbe &&
    isHermesAcpClientMethod(message.method) &&
    isHermesAcpRequestId(message.id)
  ) {
    args.writeMessage(
      {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32_000,
          message: 'ACP capability probe observed the request; local execution is disabled'
        }
      },
      message.method
    )
    return
  }
  if (
    kind === 'notification' &&
    message.method === 'session/update' &&
    isAcpRecord(message.params)
  ) {
    const update = message.params.update
    if (isAcpRecord(update) && args.activeTurn && args.acceptingPromptMessages) {
      args.activeTurn.handleUpdate(update)
    }
    return
  }
  if (kind === 'request' && message.method === 'session/request_permission') {
    args.writeMessage(
      {
        jsonrpc: '2.0',
        id: message.id,
        result: hermesAcpPermissionResult(
          message,
          args.cancelRequested || Boolean(args.capabilityProbe)
        )
      },
      'session/request_permission'
    )
    return
  }
  if (kind === 'notification' && message.method === '$/cancel_request') {
    const params = isAcpRecord(message.params) ? message.params : null
    if (params && isHermesAcpRequestId(params.requestId)) {
      filesystemRequests?.cancelRequest(params.requestId)
      terminalRequests?.cancelRequest(params.requestId)
    }
    return
  }
  if (kind === 'request' && isHermesAcpRequestId(message.id)) {
    args.writeMessage(
      {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32_601, message: 'ACP client method is not supported' }
      },
      typeof message.method === 'string' ? message.method : undefined
    )
  }
}
