import { lstat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Store } from '../persistence'
import type { PickTeamChatAttachmentsResult } from '../../shared/hermes-team-chat-attachments'
import { resolveAuthorizedPath } from './filesystem-auth'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'
import { admitTeamChatAttachmentFile } from './hermes-team-chat-attachment-picker'

function projectRelativeSegments(value: string): string[] {
  if (!value || value.includes('\0') || isAbsolute(value)) {
    throw new Error('invalid project attachment path')
  }
  const segments = value.replaceAll('\\', '/').split('/')
  if (
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || segment.toLowerCase() === '.git'
    )
  ) {
    throw new Error('invalid project attachment path')
  }
  return segments
}

function isInsideProject(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset !== '' && !offset.startsWith('..') && !isAbsolute(offset)
}

export async function attachTeamChatProjectFile(args: {
  cwd: string
  relativePath: string
  conversationId: string
  store: Store
  artifactStore: HermesBinaryArtifactStore
}): Promise<PickTeamChatAttachmentsResult> {
  const root = await resolveAuthorizedPath(args.cwd, args.store)
  if (!(await lstat(root)).isDirectory()) {
    throw new Error('selected project root is not a directory')
  }
  const target = await resolveAuthorizedPath(
    resolve(root, ...projectRelativeSegments(args.relativePath)),
    args.store
  )
  if (!isInsideProject(root, target)) {
    throw new Error('project attachment resolves outside the selected project')
  }
  const attachment = await admitTeamChatAttachmentFile({
    path: target,
    conversationId: args.conversationId,
    artifactStore: args.artifactStore,
    allowAnyUtf8Text: true
  })
  return { cancelled: false, attachments: [attachment], rejected: [] }
}
