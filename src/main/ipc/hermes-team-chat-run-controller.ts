import type { spawn } from 'node:child_process'
import { cancelExcelArtifactWorker } from './hermes-excel-artifact-worker-client'
import { cancelLocalDocumentWorkers } from './hermes-local-document-worker-client'
import { stopRemoteTeamChat } from './hermes-team-chat-ssh-process'

export type TeamChatRunController = {
  proc: ReturnType<typeof spawn> | null
  stage: 'transfer' | 'agent' | null
  cancelledReason: 'cancelled' | 'timeout' | null
  cancelAgent: (() => Promise<boolean>) | null
  hardStopTimer: ReturnType<typeof setTimeout> | null
  stop: (reason: 'cancelled' | 'timeout') => Promise<boolean>
}

const inFlight = new Map<string, TeamChatRunController>()

export function registerTeamChatRun(requestId: string, host: string): TeamChatRunController | null {
  if (inFlight.has(requestId)) {
    return null
  }
  const controller: TeamChatRunController = {
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
      if (cancelLocalDocumentWorkers(requestId) || cancelExcelArtifactWorker(requestId)) {
        controller.cancelledReason = reason
        return true
      }
      if (controller.cancelAgent) {
        const stopped = await controller.cancelAgent()
        if (stopped) {
          controller.cancelledReason = reason
        }
        return stopped
      }
      if (activeProcess && !(await stopRemoteTeamChat(host, requestId))) {
        return false
      }
      controller.cancelledReason = reason
      activeProcess?.kill()
      return true
    }
  }
  inFlight.set(requestId, controller)
  return controller
}

export function unregisterTeamChatRun(requestId: string): void {
  inFlight.delete(requestId)
}

export async function cancelRegisteredTeamChatRun(requestId: string): Promise<boolean> {
  return (await inFlight.get(requestId)?.stop('cancelled')) ?? false
}
