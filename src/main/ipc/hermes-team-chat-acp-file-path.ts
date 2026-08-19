import { lstat } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve } from 'node:path'
import type { Store } from '../persistence'
import { isENOENT, resolveAuthorizedPath } from './filesystem-auth'

const MAX_ACP_PATH_CHARS = 4096
const VIRTUAL_PROJECT_ROOT = '/workspace'
const WINDOWS_DEVICE_SEGMENT_RE =
  /^(?:aux|clock\$|con|conin\$|conout\$|nul|prn|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i

export type HermesAcpProjectFile = {
  absolutePath: string
  relativePath: string
}

function insideRoot(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

function virtualSegments(relativePath: string): string[] {
  const segments = relativePath.split('/')
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.includes(':') ||
        WINDOWS_DEVICE_SEGMENT_RE.test(segment) ||
        /[. ]$/.test(segment)
    )
  ) {
    throw new Error('ACP file path contains an unsupported segment')
  }
  return segments
}

async function rejectSymlinks(root: string, segments: string[]): Promise<void> {
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error('symbolic links are not supported')
      }
    } catch (error) {
      if (isENOENT(error)) {
        return
      }
      throw error
    }
  }
}

export async function resolveHermesAcpProjectFile(args: {
  pathValue: string
  projectRoot: string
  store: Store
}): Promise<HermesAcpProjectFile> {
  if (
    !args.pathValue ||
    args.pathValue.length > MAX_ACP_PATH_CHARS ||
    args.pathValue.includes('\0') ||
    args.pathValue.includes('\\') ||
    !posix.isAbsolute(args.pathValue)
  ) {
    throw new Error('ACP file paths must be absolute')
  }
  const normalizedPath = posix.normalize(args.pathValue)
  const virtualRelativePath = posix.relative(VIRTUAL_PROJECT_ROOT, normalizedPath)
  if (
    virtualRelativePath === '' ||
    virtualRelativePath.startsWith('..') ||
    posix.isAbsolute(virtualRelativePath)
  ) {
    throw new Error('path resolves outside the selected project')
  }
  const segments = virtualSegments(virtualRelativePath)
  await rejectSymlinks(args.projectRoot, segments)
  const absolutePath = await resolveAuthorizedPath(
    resolve(args.projectRoot, ...segments),
    args.store
  )
  await rejectSymlinks(args.projectRoot, segments)
  if (!insideRoot(args.projectRoot, absolutePath) || absolutePath === args.projectRoot) {
    throw new Error('path resolves outside the selected project')
  }
  return { absolutePath, relativePath: relative(args.projectRoot, absolutePath) }
}
