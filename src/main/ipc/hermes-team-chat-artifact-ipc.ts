import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import { pickTeamChatAttachments } from './hermes-team-chat-attachment-picker'
import { attachTeamChatProjectFile } from './hermes-team-chat-project-attachment'

const NAME_RE = /^[A-Za-z0-9._-]+$/

export function registerTeamChatArtifactHandlers(
  artifactStore: HermesBinaryArtifactStore,
  store: Store
): void {
  ipcMain.handle('hermes:pickTeamChatAttachments', async (event, input: unknown) => {
    const value = input as { conversationId?: unknown; remainingSlots?: unknown } | null
    if (
      !value ||
      typeof value.conversationId !== 'string' ||
      !NAME_RE.test(value.conversationId) ||
      !Number.isInteger(value.remainingSlots)
    ) {
      return { cancelled: false, attachments: [], rejected: ['invalid request'] }
    }
    return pickTeamChatAttachments({
      event,
      conversationId: value.conversationId,
      remainingSlots: Math.max(0, Math.min(5, Number(value.remainingSlots))),
      artifactStore
    })
  })
  ipcMain.handle('hermes:attachTeamChatProjectFile', async (_event, input: unknown) => {
    const value = input as {
      conversationId?: unknown
      cwd?: unknown
      relativePath?: unknown
    } | null
    if (
      !value ||
      typeof value.conversationId !== 'string' ||
      !NAME_RE.test(value.conversationId) ||
      typeof value.cwd !== 'string' ||
      !value.cwd.trim() ||
      value.cwd.length > 4_096 ||
      typeof value.relativePath !== 'string' ||
      value.relativePath.length > 2_048
    ) {
      return { cancelled: false, attachments: [], rejected: ['invalid request'] }
    }
    try {
      return await attachTeamChatProjectFile({
        conversationId: value.conversationId,
        cwd: value.cwd,
        relativePath: value.relativePath,
        store,
        artifactStore
      })
    } catch {
      return { cancelled: false, attachments: [], rejected: ['project file'] }
    }
  })
  ipcMain.handle('hermes:releaseTeamChatArtifact', async (_event, input: unknown) => {
    const value = input as { artifactId?: unknown; conversationId?: unknown } | null
    const released =
      Boolean(value) &&
      typeof value?.artifactId === 'string' &&
      typeof value.conversationId === 'string' &&
      NAME_RE.test(value.conversationId) &&
      (await artifactStore.release(value.artifactId, value.conversationId))
    return { ok: true, released }
  })
}
