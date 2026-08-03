import { spawn } from 'node:child_process'
import type { Store } from '../persistence'
import { executeLocalFileRequest } from './hermes-local-project-files'
import {
  formatLocalFileResults,
  LOCAL_PROJECT_FILE_PROTOCOL_PROMPT,
  parseLocalFileRequest
} from './hermes-local-file-protocol'
import {
  buildTeamChatAcpRemoteCommand,
  buildTeamChatCancelRemoteCommand,
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
import { runHermesAcpProcess } from './hermes-team-chat-acp-client'
import { runClaudeStreamProcess } from './hermes-team-chat-claude-stream'
import type { TeamChatProgressEvent } from '../../shared/hermes-team-chat-progress'
import type { TeamChatImageAttachment } from '../../shared/hermes-team-chat-attachments'
import {
  appendRemoteImageInstructions,
  cleanupTeamChatClipboardImages,
  uploadTeamChatClipboardImages
} from './hermes-team-chat-image-transfer'
import { localFileProgress } from './hermes-local-file-progress'

const CANCEL_TIMEOUT_MS = 15_000
const MAX_LOCAL_FILE_ROUNDS = 8

type TeamChatResult = { ok: boolean; reply?: string; error?: string }
type RunningProcess = ReturnType<typeof spawn>
type InFlightController = {
  proc: RunningProcess | null
  stage: 'transfer' | 'agent' | null
  cancelledReason: 'cancelled' | 'timeout' | null
  stop: (reason: 'cancelled' | 'timeout') => Promise<boolean>
}

const inFlight = new Map<string, InFlightController>()

const SSH_MUX_ARGS =
  process.platform === 'win32'
    ? []
    : [
        '-o',
        'ControlMaster=auto',
        '-o',
        'ControlPath=/tmp/.samwoo-orca-ssh-%r@%h-%p',
        '-o',
        'ControlPersist=10m'
      ]

function sshArgs(host: string, remote: string): string[] {
  return [
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    ...SSH_MUX_ARGS,
    host,
    remote
  ]
}

function stopRemoteTeamChat(host: string, requestId: string): Promise<boolean> {
  return new Promise((resolveStop) => {
    const proc = spawn('ssh', sshArgs(host, buildTeamChatCancelRemoteCommand(requestId)), {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let output = ''
    let settled = false
    const finish = (stopped: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolveStop(stopped)
    }
    const timer = setTimeout(() => {
      proc.kill()
      finish(false)
    }, CANCEL_TIMEOUT_MS)
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    proc.on('error', () => finish(false))
    proc.on('close', (code) => finish(code === 0 && output.trim() === 'stopped'))
  })
}

async function runRemoteTeamChat(args: {
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
  if (resolveTeamChatModel(args.modelId).provider === 'hermes') {
    const remote = buildTeamChatAcpRemoteCommand(args)
    const proc = spawn('ssh', sshArgs(args.host, remote), {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    args.controller.proc = proc
    args.controller.stage = 'agent'
    const result = await runHermesAcpProcess({
      proc,
      requestId: args.requestId,
      profile: args.profile,
      modelId: args.modelId,
      message: args.message,
      onProgress: args.onProgress
    })
    if (args.controller.proc === proc) {
      args.controller.proc = null
      args.controller.stage = null
    }
    return result
  }

  const remote = buildTeamChatRemoteCommand(args)
  const proc = spawn('ssh', sshArgs(args.host, remote), {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  args.controller.proc = proc
  args.controller.stage = 'agent'
  const result = await runClaudeStreamProcess({
    proc,
    requestId: args.requestId,
    message: args.message,
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

  try {
    const remoteImages = await uploadTeamChatClipboardImages({
      requestId: args.requestId,
      attachments: args.imageAttachments,
      sshArgs: (remoteCommand) => sshArgs(args.host, remoteCommand),
      onProcess: (process) => {
        controller.proc = process
        controller.stage = process ? 'transfer' : null
      }
    })
    const deviceContext = await getTeamChatDeviceContext(args.cwd)
    let conversationMessage = appendRemoteImageInstructions(args.message, remoteImages)
    for (let round = 0; round <= MAX_LOCAL_FILE_ROUNDS; round += 1) {
      const cancelled = cancellationResult(controller.cancelledReason)
      if (cancelled) {
        return cancelled
      }
      const fullMessage = formatTeamChatMessage({
        contextLine: `${formatTeamChatDeviceContext(deviceContext)}${LOCAL_PROJECT_FILE_PROTOCOL_PROMPT}\n`,
        history: args.history,
        message: conversationMessage
      })
      const result = await runRemoteTeamChat({
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
      const localRequest = parseLocalFileRequest(result.reply)
      if (!localRequest) {
        return result
      }
      if (round === MAX_LOCAL_FILE_ROUNDS) {
        return { ok: false, error: 'local file request limit exceeded' }
      }
      const localResults = await executeLocalFileRequest({
        cwd: args.cwd,
        request: localRequest,
        store: args.store,
        onOperationStart: (operation) => {
          args.onProgress?.(localFileProgress(args.requestId, operation, 'in_progress'))
        },
        onOperationComplete: (operation, operationResult) => {
          args.onProgress?.(
            localFileProgress(
              args.requestId,
              operation,
              operationResult.ok ? 'completed' : 'failed',
              operationResult.error
            )
          )
        }
      }).catch((error: unknown) =>
        localRequest.operations.map((operation) => ({
          id: operation.id,
          ok: false,
          path: operation.path,
          error: error instanceof Error ? error.message : String(error)
        }))
      )
      conversationMessage = [
        conversationMessage,
        `에이전트 로컬파일 요청:\n${result.reply}`,
        `Orca 로컬파일 결과:\n${formatLocalFileResults(localResults)}`,
        '위 결과를 사용해 계속 진행하세요. 추가 파일 작업이 필요하면 로컬파일도구 형식만 출력하고, 완료됐으면 사용자에게 최종 답변하세요.'
      ].join('\n\n')
    }
    return { ok: false, error: 'local file request limit exceeded' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
    if (args.imageAttachments.length > 0) {
      await cleanupTeamChatClipboardImages(args.requestId, (remoteCommand) =>
        sshArgs(args.host, remoteCommand)
      ).catch(() => {})
    }
    inFlight.delete(args.requestId)
  }
}

export async function cancelTeamChatMessage(requestId: string): Promise<boolean> {
  return (await inFlight.get(requestId)?.stop('cancelled')) ?? false
}
