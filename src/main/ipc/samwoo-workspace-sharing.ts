import { request } from 'node:http'
import { ipcMain } from 'electron'
import type {
  CreateSamwooWorkspaceCommentArgs,
  CreateSamwooWorkspaceShareArgs,
  ListSamwooWorkspaceCommentsArgs,
  SamwooWorkspaceShareResult,
  SetSamwooWorkspaceCommentCompletedArgs,
  UpdateSamwooWorkspaceShareArgs
} from '../../shared/samwoo-workspace-sharing'

const AUTH_URL = 'http://100.116.18.119:8823'
const MAX_RESPONSE_BYTES = 512 * 1024

function postWorkspaceShare(
  path: string,
  token: string,
  body: Record<string, unknown> = {}
): Promise<SamwooWorkspaceShareResult> {
  return new Promise((resolve) => {
    const url = new URL(path, AUTH_URL)
    const payload = JSON.stringify(body)
    const req = request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30_000
      },
      (response) => {
        let responseBody = ''
        let responseBytes = 0
        response.on('data', (chunk: Buffer) => {
          responseBytes += chunk.length
          if (responseBytes <= MAX_RESPONSE_BYTES) {
            responseBody += chunk.toString('utf8')
          }
        })
        response.on('end', () => {
          if (responseBytes > MAX_RESPONSE_BYTES) {
            resolve({ ok: false, error: 'workspace share response is too large' })
            return
          }
          try {
            resolve(JSON.parse(responseBody) as SamwooWorkspaceShareResult)
          } catch {
            resolve({ ok: false, error: `bad response (${response.statusCode})` })
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ ok: false, error: 'workspace share server timed out' })
    })
    req.on('error', (error) => resolve({ ok: false, error: error.message }))
    req.end(payload)
  })
}

function hasToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 20 && token.length <= 256
}

export function registerSamwooWorkspaceSharingHandlers(): void {
  ipcMain.handle('samwooWorkspaceShares:list', (_event, token: unknown) =>
    hasToken(token)
      ? postWorkspaceShare('/workspace-shares/list', token)
      : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle('samwooWorkspaceShares:create', (_event, args: CreateSamwooWorkspaceShareArgs) =>
    hasToken(args?.token)
      ? postWorkspaceShare('/workspace-shares/create', args.token, {
          displayName: args.displayName,
          repositoryUrl: args.repositoryUrl,
          defaultBranch: args.defaultBranch,
          description: args.description,
          permission: args.permission
        })
      : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle('samwooWorkspaceShares:update', (_event, args: UpdateSamwooWorkspaceShareArgs) =>
    hasToken(args?.token)
      ? postWorkspaceShare('/workspace-shares/update', args.token, {
          id: args.id,
          displayName: args.displayName,
          description: args.description,
          permission: args.permission
        })
      : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle('samwooWorkspaceShares:revoke', (_event, args: { token?: string; id?: string }) =>
    hasToken(args?.token) && typeof args.id === 'string'
      ? postWorkspaceShare('/workspace-shares/revoke', args.token, { id: args.id })
      : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle(
    'samwooWorkspaceShares:listComments',
    (_event, args: ListSamwooWorkspaceCommentsArgs) =>
      hasToken(args?.token) && typeof args.shareId === 'string'
        ? postWorkspaceShare('/workspace-shares/comments/list', args.token, {
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
        ? postWorkspaceShare('/workspace-shares/comments/create', args.token, {
            shareId: args.shareId,
            body: args.body
          })
        : Promise.resolve({ ok: false, error: 'login required' })
  )
  ipcMain.handle(
    'samwooWorkspaceShares:setCommentCompleted',
    (_event, args: SetSamwooWorkspaceCommentCompletedArgs) =>
      hasToken(args?.token) && typeof args.shareId === 'string'
        ? postWorkspaceShare('/workspace-shares/comments/complete', args.token, {
            shareId: args.shareId,
            commentId: args.commentId,
            completed: args.completed
          })
        : Promise.resolve({ ok: false, error: 'login required' })
  )
}
