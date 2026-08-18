import { lstat } from 'node:fs/promises'
import type { Store } from '../persistence'
import { resolveAuthorizedPath } from './filesystem-auth'
import {
  resolveHermesAcpCapabilityProbe,
  type HermesAcpCapabilityProbe
} from './hermes-team-chat-acp-capability-probe'
import {
  resolveHermesAcpLocalFilesCapability,
  type HermesAcpLocalFilesCapability
} from './hermes-team-chat-acp-local-files-capability'

export async function resolveTeamChatProjectDirectory(
  cwd: string,
  store: Store
): Promise<string | null> {
  if (!cwd.trim()) {
    return null
  }
  try {
    const authorizedPath = await resolveAuthorizedPath(cwd, store)
    return (await lstat(authorizedPath)).isDirectory() ? authorizedPath : null
  } catch {
    return null
  }
}

export async function resolveTeamChatProjectCapabilityProbe(args: {
  profile: string
  isDevelopment: boolean
  requestedMode?: string
  cwd: string
  store: Store
}): Promise<HermesAcpCapabilityProbe | null> {
  const requestedProbe = resolveHermesAcpCapabilityProbe({
    profile: args.profile,
    isDevelopment: args.isDevelopment,
    requestedMode: args.requestedMode,
    sessionCwd: args.cwd
  })
  if (!requestedProbe) {
    return null
  }
  const sessionCwd = await resolveTeamChatProjectDirectory(args.cwd, args.store)
  return sessionCwd ? { ...requestedProbe, sessionCwd } : null
}

export async function resolveTeamChatProjectLocalFilesCapability(args: {
  profile: string
  cwd: string
  store: Store
}): Promise<HermesAcpLocalFilesCapability | null> {
  if (args.profile !== 'ai_center') {
    return null
  }
  const projectRoot = await resolveTeamChatProjectDirectory(args.cwd, args.store)
  return resolveHermesAcpLocalFilesCapability({
    profile: args.profile,
    projectRoot: projectRoot ?? undefined
  })
}
