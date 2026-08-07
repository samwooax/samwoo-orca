import { ipcMain } from 'electron'
import type {
  ListSamwooProfileMessagesArgs,
  MarkSamwooProfileMessagesReadArgs,
  SamwooProfileMessagingResult,
  SendSamwooProfileMessageArgs
} from '../../shared/samwoo-profile-messaging'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'

function hasToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 20 && token.length <= 256
}

const loginRequired = (): Promise<SamwooProfileMessagingResult> =>
  Promise.resolve({ ok: false, error: 'login required' })

export function registerSamwooProfileMessagingHandlers(): void {
  ipcMain.handle('samwooProfileMessages:listChannels', (_event, token: unknown) =>
    hasToken(token)
      ? postSamwooWorkspaceShare<SamwooProfileMessagingResult>(
          '/profile-messages/channels/list',
          token
        )
      : loginRequired()
  )
  ipcMain.handle(
    'samwooProfileMessages:listMessages',
    (_event, args: ListSamwooProfileMessagesArgs) =>
      hasToken(args?.token)
        ? postSamwooWorkspaceShare<SamwooProfileMessagingResult>(
            '/profile-messages/list',
            args.token,
            {
              channelKind: args.channelKind,
              shareId: args.shareId,
              beforeCreatedAt: args.beforeCreatedAt,
              beforeId: args.beforeId
            }
          )
        : loginRequired()
  )
  ipcMain.handle(
    'samwooProfileMessages:sendMessage',
    (_event, args: SendSamwooProfileMessageArgs) =>
      hasToken(args?.token)
        ? postSamwooWorkspaceShare<SamwooProfileMessagingResult>(
            '/profile-messages/send',
            args.token,
            {
              channelKind: args.channelKind,
              shareId: args.shareId,
              body: args.body,
              replyToId: args.replyToId
            }
          )
        : loginRequired()
  )
  ipcMain.handle(
    'samwooProfileMessages:markRead',
    (_event, args: MarkSamwooProfileMessagesReadArgs) =>
      hasToken(args?.token)
        ? postSamwooWorkspaceShare<SamwooProfileMessagingResult>(
            '/profile-messages/read',
            args.token,
            {
              channelKind: args.channelKind,
              shareId: args.shareId,
              messageId: args.messageId
            }
          )
        : loginRequired()
  )
}
