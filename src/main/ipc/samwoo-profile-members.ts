import { ipcMain } from 'electron'
import type { SamwooProfileMembersResult } from '../../shared/samwoo-profile-members'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'

function hasToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 20 && token.length <= 256
}

export function registerSamwooProfileMemberHandlers(): void {
  ipcMain.handle('samwooProfileMembers:list', (_event, token: unknown) =>
    hasToken(token)
      ? postSamwooWorkspaceShare<SamwooProfileMembersResult>('/profile-members/list', token)
      : Promise.resolve({ ok: false, error: 'login required' })
  )
}
