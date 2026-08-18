import { lstat } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve } from 'node:path'
import type { Store } from '../persistence'
import { resolveAuthorizedPath } from './filesystem-auth'

const VIRTUAL_PROJECT_ROOT = '/workspace'
const MAX_CWD_CHARS = 4_096
const WINDOWS_DEVICE_SEGMENT_RE =
  /^(?:aux|clock\$|con|conin\$|conout\$|nul|prn|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i

function isInsideRoot(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

function virtualSegments(cwd: string): string[] {
  if (
    !cwd ||
    cwd.length > MAX_CWD_CHARS ||
    cwd.includes('\0') ||
    cwd.includes('\\') ||
    !posix.isAbsolute(cwd)
  ) {
    throw new Error('ACP terminal cwd must be under /workspace')
  }
  const normalized = posix.normalize(cwd)
  const offset = posix.relative(VIRTUAL_PROJECT_ROOT, normalized)
  if (offset.startsWith('..') || posix.isAbsolute(offset)) {
    throw new Error('ACP terminal cwd must be under /workspace')
  }
  if (!offset) {
    return []
  }
  const segments = offset.split('/')
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
    throw new Error('ACP terminal cwd contains an unsupported segment')
  }
  return segments
}

async function rejectSymlinkSegments(root: string, segments: string[]): Promise<void> {
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('ACP terminal cwd cannot contain symbolic links')
    }
  }
}

export async function resolveHermesAcpTerminalDirectory(args: {
  projectRoot: string
  virtualCwd: string
  store: Store
}): Promise<string> {
  const segments = virtualSegments(args.virtualCwd)
  await rejectSymlinkSegments(args.projectRoot, segments)
  const target = await resolveAuthorizedPath(resolve(args.projectRoot, ...segments), args.store)
  await rejectSymlinkSegments(args.projectRoot, segments)
  const info = await lstat(target)
  if (!isInsideRoot(args.projectRoot, target) || !info.isDirectory()) {
    throw new Error('ACP terminal cwd is not an approved project directory')
  }
  return target
}
