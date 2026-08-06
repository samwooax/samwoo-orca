import { ipcMain } from 'electron'
import type {
  CreateSamwooWorkspaceCommentArgs,
  CreateSamwooWorkspaceShareArgs,
  ListSamwooWorkspaceCommentsArgs,
  SetSamwooWorkspaceCommentCompletedArgs,
  UpdateSamwooWorkspaceShareArgs
} from '../../shared/samwoo-workspace-sharing'
import { registerSamwooWorkspaceFileSyncHandlers } from './samwoo-workspace-file-sync'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'

function hasToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 20 && token.length <= 256
}

export function registerSamwooWorkspaceSharingHandlers(): void {
  ipcMain.handle('samwooWorkspaceShares:list', (_event, token: unknown) =>
    hasToken(token)
      ? postSamwooWorkspaceShare('/workspace-shares/list', token)
      : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle('samwooWorkspaceShares:create', (_event, args: CreateSamwooWorkspaceShareArgs) =>
    hasToken(args?.token)
      ? postSamwooWorkspaceShare('/workspace-shares/create', args.token, {
          displayName: args.displayName,
          repositoryUrl: args.repositoryUrl,
          sourceKind: args.sourceKind,
          defaultBranch: args.defaultBranch,
          description: args.description,
          permission: args.permission
        })
      : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle('samwooWorkspaceShares:update', (_event, args: UpdateSamwooWorkspaceShareArgs) =>
    hasToken(args?.token)
      ? postSamwooWorkspaceShare('/workspace-shares/update', args.token, {
          id: args.id,
          displayName: args.displayName,
          description: args.description,
          permission: args.permission
        })
      : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle('samwooWorkspaceShares:revoke', (_event, args: { token?: string; id?: string }) =>
    hasToken(args?.token) && typeof args.id === 'string'
      ? postSamwooWorkspaceShare('/workspace-shares/revoke', args.token, { id: args.id })
      : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle(
    'samwooWorkspaceShares:listComments',
    (_event, args: ListSamwooWorkspaceCommentsArgs) =>
      hasToken(args?.token) && typeof args.shareId === 'string'
        ? postSamwooWorkspaceShare('/workspace-shares/comments/list', args.token, {
            shareId: args.shareId,
            beforeCreatedAt: args.beforeCreatedAt,
            beforeId: args.beforeId
          })
        : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle(
    'samwooWorkspaceShares:createComment',
    (_event, args: CreateSamwooWorkspaceCommentArgs) =>
      hasToken(args?.token) && typeof args.shareId === 'string'
        ? postSamwooWorkspaceShare('/workspace-shares/comments/create', args.token, {
            shareId: args.shareId,
            body: args.body
          })
        : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle(
    'samwooWorkspaceShares:setCommentCompleted',
    (_event, args: SetSamwooWorkspaceCommentCompletedArgs) =>
      hasToken(args?.token) && typeof args.shareId === 'string'
        ? postSamwooWorkspaceShare('/workspace-shares/comments/complete', args.token, {
            shareId: args.shareId,
            commentId: args.commentId,
            completed: args.completed
          })
        : Promise.resolve({ ok: false, error: 'login required' })
  )
  registerSamwooWorkspaceFileSyncHandlers()
}
