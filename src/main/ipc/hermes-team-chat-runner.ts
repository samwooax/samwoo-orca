import { spawn } from 'node:child_process'
import type { Store } from '../persistence'
import {
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
import { hasOrcaToolEnvelope } from './hermes-team-chat-acp-capability-probe'
import {
  HermesTeamChatSessionRegistry,
  type TeamChatSessionHandle
} from './hermes-team-chat-session-registry'
import { acquireHermesTeamChatAcpSession } from './hermes-team-chat-acp-session-acquisition'
import { resolveTeamChatProjectDirectory } from './hermes-team-chat-project-directory'
import {
  formatHermesAcpProjectRolloutContext,
  resolveHermesAcpProjectRollout
} from './hermes-team-chat-acp-project-rollout'
import { runClaudeStreamProcess } from './hermes-team-chat-claude-stream'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import {
  appendRemoteImageInstructions,
  cleanupTeamChatImages,
  uploadTeamChatImages
} from './hermes-team-chat-image-transfer'
import type { PreparedTeamChatImageAttachment } from './hermes-team-chat-attachment-normalization'
import { localProjectToolProtocolPrompt } from './hermes-local-project-tool-loop'
import type { LocalDocumentAttachment } from './hermes-local-document-protocol'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import { getExcelArtifactCapability } from './hermes-excel-artifact-worker-client'
import type { ExcelArtifactCapability } from '../../shared/hermes-excel-artifact'
import { teamChatSshArgs } from './hermes-team-chat-ssh-process'
import type {
  HermesTeamChatResult,
  TeamChatLocalToolExecution
} from '../../shared/hermes-team-chat-result'
import {
  advanceTeamChatLocalToolTurn,
  attachTeamChatToolExecutions,
  MAX_LOCAL_TOOL_ROUNDS
} from './hermes-team-chat-local-tool-turn'
import {
  cancelRegisteredTeamChatRun,
  registerTeamChatRun,
  unregisterTeamChatRun,
  type TeamChatRunController
} from './hermes-team-chat-run-controller'
import { teamChatCancellationResult } from './hermes-team-chat-cancellation-result'

const hermesSessions = new HermesTeamChatSessionRegistry()

async function availableExcelArtifactCapability(
  cwd: string,
  store: Store
): Promise<ExcelArtifactCapability | null> {
  const capability = await getExcelArtifactCapability()
  if (!capability || !cwd.trim()) {
    return capability
  }
  return (await resolveTeamChatProjectDirectory(cwd, store)) ? capability : null
}

async function runOneShotRemoteTeamChat(args: {
  requestId: string
  host: string
  profile: string
  modelId: TeamChatModelId
  effort: TeamChatEffort
  mailToken?: string
  message: string
  controller: TeamChatRunController
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<HermesTeamChatResult> {
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

export async function runTeamChatMessage(args: {
  requestId: string
  conversationId: string
  host: string
  profile: string
  modelId: TeamChatModelId
  effort: TeamChatEffort
  message: string
  imageAttachments: PreparedTeamChatImageAttachment[]
  documentAttachments?: LocalDocumentAttachment[]
  history: TeamChatHistoryMessage[]
  cwd: string
  store: Store
  artifactStore?: HermesBinaryArtifactStore
  mailToken?: string
  isDevelopment?: boolean
  acpCapabilityProbeMode?: string
  acpBackupRoot?: string
  onProgress?: (event: TeamChatProgressEvent) => void
}): Promise<HermesTeamChatResult> {
  const controller = registerTeamChatRun(args.requestId, args.host)
  if (!controller) {
    return { ok: false, error: 'a request with this ID is already running' }
  }
  const timer = setTimeout(() => {
    void controller.stop('timeout')
  }, TEAM_CHAT_MESSAGE_TIMEOUT_MS)
  let sessionHandle: TeamChatSessionHandle | null = null
  let protocolRepairAttempts = 0
  const toolExecutions: TeamChatLocalToolExecution[] = []

  try {
    const remoteImages = await uploadTeamChatImages({
      requestId: args.requestId,
      attachments: args.imageAttachments,
      artifactStore: args.artifactStore,
      sshArgs: (remoteCommand) => teamChatSshArgs(args.host, remoteCommand),
      onProcess: (process) => {
        controller.proc = process
        controller.stage = process ? 'transfer' : null
      }
    })
    const deviceContext = await getTeamChatDeviceContext(args.cwd)
    const isHermes = resolveTeamChatModel(args.modelId).provider === 'hermes'
    const { capabilityProbe, localFilesCapability } = await resolveHermesAcpProjectRollout({
      isHermes,
      profile: args.profile,
      isDevelopment: args.isDevelopment === true,
      probeMode: args.acpCapabilityProbeMode,
      backupRoot: args.acpBackupRoot,
      cwd: args.cwd,
      store: args.store
    })
    const excelCapability =
      capabilityProbe || localFilesCapability
        ? null
        : await availableExcelArtifactCapability(args.cwd, args.store)
    const acpContext = formatHermesAcpProjectRolloutContext(deviceContext, {
      capabilityProbe,
      localFilesCapability
    })
    if (!isHermes) {
      // Why: a dormant ACP session cannot observe Claude turns; close it so returning to Hermes rehydrates complete UI history.
      await hermesSessions.close(args.conversationId)
    }
    if (isHermes) {
      const configurationKey = `${args.host}\0${args.profile}\0${args.mailToken ?? ''}\0${capabilityProbe?.mode ?? ''}\0${capabilityProbe?.sessionCwd ?? ''}\0${localFilesCapability?.projectRoot ?? ''}\0${localFilesCapability?.localTerminal ? 'terminal' : ''}`
      sessionHandle = await acquireHermesTeamChatAcpSession({
        registry: hermesSessions,
        conversationId: args.conversationId,
        configurationKey,
        requestId: args.requestId,
        host: args.host,
        profile: args.profile,
        mailToken: args.mailToken,
        capabilityProbe,
        localFilesCapability,
        backupRoot: args.acpBackupRoot ?? '',
        store: args.store,
        controller
      })
    }
    let conversationMessage = appendRemoteImageInstructions(args.message, remoteImages)
    for (let round = 0; round <= MAX_LOCAL_TOOL_ROUNDS; round += 1) {
      const cancelled = teamChatCancellationResult(controller.cancelledReason)
      if (cancelled) {
        return attachTeamChatToolExecutions(cancelled, toolExecutions)
      }
      const fullMessage = formatTeamChatMessage({
        contextLine:
          round === 0
            ? (acpContext ??
              `${formatTeamChatDeviceContext(deviceContext)}${localProjectToolProtocolPrompt(excelCapability)}\n`)
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
      const stopped = teamChatCancellationResult(controller.cancelledReason)
      if (stopped) {
        return attachTeamChatToolExecutions(stopped, toolExecutions)
      }
      if (!result.ok || !result.reply) {
        return attachTeamChatToolExecutions(result, toolExecutions)
      }
      if (capabilityProbe || localFilesCapability) {
        return hasOrcaToolEnvelope(result.reply)
          ? {
              ok: false,
              error: 'ACP capability probe did not execute the returned Orca tool envelope'
            }
          : result
      }
      const toolTurn = await advanceTeamChatLocalToolTurn({
        reply: result.reply,
        cwd: args.cwd,
        store: args.store,
        artifactStore: args.artifactStore,
        excelCapability,
        conversationId: args.conversationId,
        requestId: args.requestId,
        protocolRepairAttempts,
        toolExecutions,
        documentAttachments: args.documentAttachments,
        onProgress: args.onProgress
      })
      if (toolTurn.kind === 'complete') {
        return attachTeamChatToolExecutions(result, toolExecutions)
      }
      if (toolTurn.kind === 'failed') {
        return toolTurn.result
      }
      if (toolTurn.kind === 'repair') {
        protocolRepairAttempts += 1
      }
      conversationMessage = toolTurn.message
    }
    return attachTeamChatToolExecutions(
      {
        ok: false,
        errorCode: 'local_tool_limit_exceeded',
        error: 'local project tool response limit reached'
      },
      toolExecutions
    )
  } catch (error) {
    return attachTeamChatToolExecutions(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      toolExecutions
    )
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
      await cleanupTeamChatImages(args.requestId, (remoteCommand) =>
        teamChatSshArgs(args.host, remoteCommand)
      ).catch(() => {})
    }
    unregisterTeamChatRun(args.requestId)
  }
}

export async function cancelTeamChatMessage(requestId: string): Promise<boolean> {
  return cancelRegisteredTeamChatRun(requestId)
}

export async function closeTeamChatConversation(conversationId: string): Promise<boolean> {
  return hermesSessions.close(conversationId)
}

export async function closeAllTeamChatConversations(): Promise<void> {
  await hermesSessions.closeAll()
}
