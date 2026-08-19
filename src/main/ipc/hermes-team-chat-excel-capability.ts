import type { Store } from '../persistence'
import type { ExcelArtifactCapability } from '../../shared/hermes-excel-artifact'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { getExcelArtifactCapability } from './hermes-excel-artifact-worker-client'
import { resolveTeamChatProjectDirectory } from './hermes-team-chat-project-directory'

export async function resolveTeamChatExcelArtifactCapability(
  cwd: string,
  store: Store
): Promise<ExcelArtifactCapability | null> {
  if (parseWslUncPath(cwd)) {
    return null
  }
  const capability = await getExcelArtifactCapability()
  if (!capability || !cwd.trim()) {
    return capability
  }
  const projectRoot = await resolveTeamChatProjectDirectory(cwd, store)
  return projectRoot && !parseWslUncPath(projectRoot) ? capability : null
}
