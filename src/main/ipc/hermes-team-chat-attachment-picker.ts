import { lstat, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import type {
  PickTeamChatAttachmentsResult,
  TeamChatTextAttachment
} from '../../shared/hermes-team-chat-attachments'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'

const MAX_ATTACHMENTS = 5
const MAX_TEXT_ATTACHMENT_BYTES = 96_000
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.log'])
const BINARY_EXTENSIONS = new Set(['.pdf', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg'])

async function readTextAttachment(path: string): Promise<TeamChatTextAttachment> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_TEXT_ATTACHMENT_BYTES) {
    throw new Error('text attachment exceeds the 96 KB limit')
  }
  const content = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))
  return { kind: 'text', name: path.split(/[\\/]/).at(-1) ?? 'attachment.txt', content }
}

export async function admitTeamChatAttachmentFile(args: {
  path: string
  conversationId: string
  artifactStore: HermesBinaryArtifactStore
  allowAnyUtf8Text?: boolean
}): Promise<PickTeamChatAttachmentsResult['attachments'][number]> {
  const extension = extname(args.path).toLowerCase()
  if (
    TEXT_EXTENSIONS.has(extension) ||
    (args.allowAnyUtf8Text && !BINARY_EXTENSIONS.has(extension))
  ) {
    return readTextAttachment(args.path)
  }
  if (BINARY_EXTENSIONS.has(extension)) {
    return args.artifactStore.ingestFile(args.path, args.conversationId)
  }
  throw new Error('unsupported attachment type')
}

export async function pickTeamChatAttachments(args: {
  event: IpcMainInvokeEvent
  conversationId: string
  remainingSlots: number
  artifactStore: HermesBinaryArtifactStore
}): Promise<PickTeamChatAttachmentsResult> {
  const window = BrowserWindow.fromWebContents(args.event.sender)
  const options: OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Documents and images',
        extensions: [
          'pdf',
          'xlsx',
          'pptx',
          'png',
          'jpg',
          'jpeg',
          'txt',
          'md',
          'csv',
          'json',
          'yaml',
          'yml',
          'log'
        ]
      }
    ]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled) {
    return { cancelled: true, attachments: [], rejected: [] }
  }
  const paths = result.filePaths.slice(
    0,
    Math.min(MAX_ATTACHMENTS, Math.max(0, args.remainingSlots))
  )
  const attachments: PickTeamChatAttachmentsResult['attachments'] = []
  const rejected = result.filePaths.slice(paths.length).map((path) => path.split(/[\\/]/).at(-1)!)
  for (const path of paths) {
    try {
      attachments.push(
        await admitTeamChatAttachmentFile({
          path,
          conversationId: args.conversationId,
          artifactStore: args.artifactStore
        })
      )
    } catch {
      rejected.push(path.split(/[\\/]/).at(-1) ?? 'attachment')
    }
  }
  return { cancelled: false, attachments, rejected }
}
