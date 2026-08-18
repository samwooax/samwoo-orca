import { spawn } from 'node:child_process'
import type { Store } from '../persistence'
import { buildTeamChatAcpRemoteCommand } from './hermes-team-chat-models'
import { HermesAcpSession } from './hermes-team-chat-acp-client'
import type { HermesAcpCapabilityProbe } from './hermes-team-chat-acp-capability-probe'
import type { HermesAcpLocalFilesCapability } from './hermes-team-chat-acp-local-files-capability'
import { HermesAcpFilesystem } from './hermes-team-chat-acp-filesystem'
import type {
  HermesTeamChatSessionRegistry,
  TeamChatSessionHandle
} from './hermes-team-chat-session-registry'
import type { TeamChatRunController } from './hermes-team-chat-run-controller'
import { HermesAcpTerminal } from './hermes-team-chat-acp-terminal'
import { stopRemoteTeamChat, teamChatSshArgs } from './hermes-team-chat-ssh-process'

const ACP_CANCEL_GRACE_MS = 5_000

export async function acquireHermesTeamChatAcpSession(args: {
  registry: HermesTeamChatSessionRegistry
  conversationId: string
  configurationKey: string
  requestId: string
  host: string
  profile: string
  mailToken?: string
  capabilityProbe: HermesAcpCapabilityProbe | null
  localFilesCapability: HermesAcpLocalFilesCapability | null
  backupRoot: string
  store: Store
  controller: TeamChatRunController
}): Promise<TeamChatSessionHandle> {
  const filesystem = args.localFilesCapability
    ? await HermesAcpFilesystem.create({
        cwd: args.localFilesCapability.projectRoot,
        store: args.store,
        backupRoot: args.backupRoot
      })
    : null
  const terminal = args.localFilesCapability?.localTerminal
    ? await HermesAcpTerminal.create({
        cwd: args.localFilesCapability.projectRoot,
        store: args.store
      })
    : null
  const sessionHandle = await args.registry.acquire({
    conversationId: args.conversationId,
    configurationKey: args.configurationKey,
    requestId: args.requestId,
    create: () => {
      const remote = buildTeamChatAcpRemoteCommand({
        requestId: args.conversationId,
        profile: args.profile,
        localFiles: Boolean(filesystem)
      })
      const proc = spawn('ssh', teamChatSshArgs(args.host, remote), {
        stdio: ['pipe', 'pipe', 'pipe']
      })
      return {
        client: new HermesAcpSession(proc, args.profile, args.mailToken, {
          capabilityProbe: args.capabilityProbe,
          ...(args.localFilesCapability && filesystem
            ? {
                localFiles: {
                  capability: args.localFilesCapability,
                  filesystem,
                  ...(terminal ? { terminal } : {})
                }
              }
            : {})
        }),
        dispose: async () => {
          await stopRemoteTeamChat(args.host, args.conversationId)
          proc.kill()
        }
      }
    }
  })
  args.controller.stage = 'agent'
  args.controller.cancelAgent = async () => {
    if (!sessionHandle.client.cancel()) {
      await sessionHandle.invalidate()
      return true
    }
    args.controller.hardStopTimer = setTimeout(() => {
      void sessionHandle.invalidate()
    }, ACP_CANCEL_GRACE_MS)
    args.controller.hardStopTimer.unref?.()
    return true
  }
  return sessionHandle
}
