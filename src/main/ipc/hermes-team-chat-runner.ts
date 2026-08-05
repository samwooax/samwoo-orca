import { spawn } from 'node:child_process'
import type { Store } from '../persistence'
import {
  buildTeamChatAcpRemoteCommand,
  buildTeamChatRemoteCommand,
  formatTeamChatMessage,
  resolveTeamChatModel,
  TEAM_CHAT_MESSAGE_TIMEOUT_MS,
  type TeamChatEffort,
  type TeamChatHistoryMessage,
  type TeamChatModelId
} from './hermes-team-chat-models'
import {
  formatTeamChatDeviceContext,
  getTeamChatDeviceContext
} from './hermes-team-chat-device-context'
import { HermesAcpSession } from './hermes-team-chat-acp-client'
import {
  HermesTeamChatSessionRegistry,
  type TeamChatSessionHandle
} from './hermes-team-chat-session-registry'
import { runClaudeStreamProcess } from './hermes-team-chat-claude-stream'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { TeamChatImageAttachment } from '../../shared/hermes-team-chat-attachments'
import {
  appendRemoteImageInstructions,
  cleanupTeamChatClipboardImages,
  uploadTeamChatClipboardImages
} from './hermes-team-chat-image-transfer'
import {
  executeLocalProjectToolReply,
  LOCAL_PROJECT_TOOL_PROTOCOL_PROMPT
} from './hermes-local-project-tool-loop'
import { stopRemoteTeamChat, teamChatSshArgs } from './hermes-team-chat-ssh-process'

const ACP_CANCEL_GRACE_MS = 5_000
const MAX_LOCAL_TOOL_ROUNDS = 8

type TeamChatResult = { ok: boolean; reply?: string; error?: string }
type RunningProcess = ReturnType<typeof spawn>
type InFlightController = {
  proc: RunningProcess | null
  stage: 'transfer' | 'agent' | null
  cancelledReason: 'cancelled' | 'timeout' | null
  cancelAgent: (() => Promise<boolean>) | null
  hardStopTimer: ReturnType<typeof setTimeout> | null
  stop: (reason: 'cancelled' | 'timeout') => Promise<boolean>
}

const inFlight = new Map<string, InFlightController>()
const hermesSessions = new HermesTeamChatSessionRegistry()

async function runOneShotRemoteTeamChat(args: {
  requestId: string
  host: string
  profile: string
  modelId: TeamChatModelId
  effort: TeamChatEffort
  mailToken?: string
  message: string
  controller: InFlightController
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<TeamChatResult> {
  const remote = buildTeamChatRemoteCommand(args)
  const proc = spawn('ssh', teamChatSshArgs(args.host, remote), {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  args.controller.proc = proc
  args.controller.stage = 'agent'
  const result = await runClaudeStreamProcess({
    proc,
    requestId: args.requestId,
    message: args.message,
    stdinPrefix: `${args.mailToken ?? ''}\n`,
    onProgress: args.onProgress
  })
  if (args.controller.proc === proc) {
    args.controller.proc = null
    args.controller.stage = null
  }
  return result
}

function cancellationResult(reason: InFlightController['cancelledReason']): TeamChatResult | null {
  if (!reason) {
    return null
  }
  return {
    ok: false,
    error: reason === 'timeout' ? 'timeout waiting for team agent reply' : 'cancelled'
  }
}

export async function runTeamChatMessage(args: {
  requestId: string
  conversationId: string
  host: string
  profile: string
  modelId: TeamChatModelId
  effort: TeamChatEffort
  message: string
  imageAttachments: TeamChatImageAttachment[]
  history: TeamChatHistoryMessage[]
  cwd: string
  store: Store
  mailToken?: string
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<TeamChatResult> {
  const controller: InFlightController = {
    proc: null,
    stage: null,
    cancelledReason: null,
    cancelAgent: null,
    hardStopTimer: null,
    stop: async (reason) => {
      if (controller.cancelledReason) {
        return false
      }
      const activeProcess = controller.proc
      if (activeProcess && controller.stage === 'transfer') {
        controller.cancelledReason = reason
        activeProcess.kill()
        return true
      }
      if (controller.cancelAgent) {
        const stopped = await controller.cancelAgent()
        if (stopped) {
          controller.cancelledReason = reason
        }
        return stopped
      }
      if (activeProcess && !(await stopRemoteTeamChat(args.host, args.requestId))) {
        return false
      }
      controller.cancelledReason = reason
      activeProcess?.kill()
      return true
    }
  }
  inFlight.set(args.requestId, controller)
  const timer = setTimeout(() => {
    void controller.stop('timeout')
  }, TEAM_CHAT_MESSAGE_TIMEOUT_MS)
  let sessionHandle: TeamChatSessionHandle | null = null

  try {
    const remoteImages = await uploadTeamChatClipboardImages({
      requestId: args.requestId,
      attachments: args.imageAttachments,
      sshArgs: (remoteCommand) => teamChatSshArgs(args.host, remoteCommand),
      onProcess: (process) => {
        controller.proc = process
        controller.stage = process ? 'transfer' : null
      }
    })
    const deviceContext = await getTeamChatDeviceContext(args.cwd)
    const isHermes = resolveTeamChatModel(args.modelId).provider === 'hermes'
    if (!isHermes) {
      // Why: a dormant ACP session cannot observe Claude turns; close it so returning to Hermes rehydrates complete UI history.
      await hermesSessions.close(args.conversationId)
    }
    if (isHermes) {
      const configurationKey = `${args.host}\0${args.profile}\0${args.mailToken ?? ''}`
      sessionHandle = await hermesSessions.acquire({
        conversationId: args.conversationId,
        configurationKey,
        requestId: args.requestId,
        create: () => {
          const remote = buildTeamChatAcpRemoteCommand({
            requestId: args.conversationId,
            profile: args.profile
          })
          const proc = spawn('ssh', teamChatSshArgs(args.host, remote), {
            stdio: ['pipe', 'pipe', 'pipe']
          })
          return {
            client: new HermesAcpSession(proc, args.profile, args.mailToken),
            dispose: async () => {
              await stopRemoteTeamChat(args.host, args.conversationId)
              proc.kill()
            }
          }
        }
      })
      const activeSession = sessionHandle
      controller.stage = 'agent'
      controller.cancelAgent = async () => {
        if (!activeSession.client.cancel()) {
          await activeSession.invalidate()
          return true
        }
        controller.hardStopTimer = setTimeout(() => {
          void activeSession.invalidate()
        }, ACP_CANCEL_GRACE_MS)
        controller.hardStopTimer.unref?.()
        return true
      }
    }
    let conversationMessage = appendRemoteImageInstructions(args.message, remoteImages)
    for (let round = 0; round < MAX_LOCAL_TOOL_ROUNDS; round += 1) {
      const cancelled = cancellationResult(controller.cancelledReason)
      if (cancelled) {
        return cancelled
      }
      const fullMessage = formatTeamChatMessage({
        contextLine:
          round === 0
            ? `${formatTeamChatDeviceContext(deviceContext)}${LOCAL_PROJECT_TOOL_PROTOCOL_PROMPT}\n`
            : undefined,
        history: round === 0 && (!sessionHandle || sessionHandle.created) ? args.history : [],
        message: conversationMessage
      })
      const result = sessionHandle
        ? await sessionHandle.client.prompt({
            requestId: args.requestId,
            modelId: args.modelId,
            effort: args.effort,
            message: fullMessage,
            onProgress: args.onProgress
          })
        : await runOneShotRemoteTeamChat({
            requestId: args.requestId,
            host: args.host,
            profile: args.profile,
            modelId: args.modelId,
            effort: args.effort,
            mailToken: args.mailToken,
            message: fullMessage,
            controller,
            onProgress: args.onProgress
          })
      const stopped = cancellationResult(controller.cancelledReason)
      if (stopped) {
        return stopped
      }
      if (!result.ok || !result.reply) {
        return result
      }
      const toolReply = await executeLocalProjectToolReply({
        reply: result.reply,
        cwd: args.cwd,
        store: args.store,
        requestId: args.requestId,
        onProgress: args.onProgress
      })
      if (toolReply === null) {
        return result
      }
      conversationMessage = [
        `Orca 로컬 프로젝트 도구 결과:\n${toolReply}`,
        '위 결과를 사용하세요. 추가 작업이 필요하면 해당 로컬 도구 형식만 출력하세요. 사용자 판단이 필요하면 질문한 뒤 이번 턴을 종료하고, 완료됐으면 최종 답변하세요.'
      ].join('\n\n')
    }
    return { ok: false, error: 'local project tool request limit exceeded' }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timer)
    if (controller.hardStopTimer) {
      clearTimeout(controller.hardStopTimer)
    }
    controller.cancelAgent = null
    controller.stage = null
    if (sessionHandle?.client.isClosed) {
      await sessionHandle.invalidate()
    } else {
      sessionHandle?.release()
    }
    if (args.imageAttachments.length > 0) {
      await cleanupTeamChatClipboardImages(args.requestId, (remoteCommand) =>
        teamChatSshArgs(args.host, remoteCommand)
      ).catch(() => {})
    }
    inFlight.delete(args.requestId)
  }
}

export async function cancelTeamChatMessage(requestId: string): Promise<boolean> {
  return (await inFlight.get(requestId)?.stop('cancelled')) ?? false
}

export async function closeTeamChatConversation(conversationId: string): Promise<boolean> {
  return hermesSessions.close(conversationId)
}

export async function closeAllTeamChatConversations(): Promise<void> {
  await hermesSessions.closeAll()
}
