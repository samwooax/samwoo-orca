import { ipcMain } from 'electron'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import { pickTeamChatAttachments } from './hermes-team-chat-attachment-picker'

const NAME_RE = /^[A-Za-z0-9._-]+$/

export function registerTeamChatArtifactHandlers(artifactStore: HermesBinaryArtifactStore): void {
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
