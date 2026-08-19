import type { Store } from '../persistence'
import type { ExcelArtifactCapability } from '../../shared/hermes-excel-artifact'
import {
  formatHermesAcpCapabilityProbeContext,
  type HermesAcpCapabilityProbe
} from './hermes-team-chat-acp-capability-probe'
import {
  formatHermesAcpLocalFilesContext,
  type HermesAcpLocalFilesCapability
} from './hermes-team-chat-acp-local-files-capability'
import {
  formatTeamChatDeviceContext,
  type TeamChatDeviceContext
} from './hermes-team-chat-device-context'
import {
  resolveTeamChatProjectCapabilityProbe,
  resolveTeamChatProjectLocalFilesCapability
} from './hermes-team-chat-project-directory'
import { excelArtifactProtocolPrompt } from './hermes-excel-artifact-protocol'

export type HermesAcpProjectRollout = {
  capabilityProbe: HermesAcpCapabilityProbe | null
  localFilesCapability: HermesAcpLocalFilesCapability | null
}

export async function resolveHermesAcpProjectRollout(args: {
  isHermes: boolean
  profile: string
  isDevelopment: boolean
  probeMode?: string
  backupRoot?: string
  cwd: string
  store: Store
}): Promise<HermesAcpProjectRollout> {
  if (!args.isHermes) {
    return { capabilityProbe: null, localFilesCapability: null }
  }
  const localFilesCapability = args.backupRoot
    ? await resolveTeamChatProjectLocalFilesCapability({
        profile: args.profile,
        cwd: args.cwd,
        store: args.store
      })
    : null
  const capabilityProbe = localFilesCapability
    ? null
    : await resolveTeamChatProjectCapabilityProbe({
        profile: args.profile,
        isDevelopment: args.isDevelopment,
        requestedMode: args.probeMode,
        cwd: args.cwd,
        store: args.store
      })
  return { capabilityProbe, localFilesCapability }
}

export function formatHermesAcpProjectRolloutContext(
  context: TeamChatDeviceContext,
  rollout: HermesAcpProjectRollout,
  excelCapability: ExcelArtifactCapability | null = null
): string | null {
  if (rollout.localFilesCapability) {
    return `${formatTeamChatDeviceContext(context)}${
      excelCapability ? `${excelArtifactProtocolPrompt(excelCapability)}\n` : ''
    }${formatHermesAcpLocalFilesContext(
      rollout.localFilesCapability.localTerminal,
      Boolean(excelCapability)
    )}`
  }
  return rollout.capabilityProbe
    ? formatHermesAcpCapabilityProbeContext(context, rollout.capabilityProbe.mode)
    : null
}
