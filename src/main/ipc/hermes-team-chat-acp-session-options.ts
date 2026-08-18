import type { HermesAcpCapabilityProbe } from './hermes-team-chat-acp-capability-probe'
import type { HermesAcpFilesystem } from './hermes-team-chat-acp-filesystem'
import type { HermesAcpLocalFilesCapability } from './hermes-team-chat-acp-local-files-capability'
import type { HermesAcpTerminal } from './hermes-team-chat-acp-terminal'

export type HermesAcpSessionOptions = {
  capabilityProbe?: HermesAcpCapabilityProbe | null
  localFiles?: {
    capability: HermesAcpLocalFilesCapability
    filesystem: HermesAcpFilesystem
    terminal?: HermesAcpTerminal | null
  } | null
  log?: (line: string) => void
}
