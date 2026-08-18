import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveHermesAcpTerminalDirectory } from './hermes-team-chat-acp-terminal-directory'

const { resolveAuthorizedPathMock } = vi.hoisted(() => ({
  resolveAuthorizedPathMock: vi.fn(async (target: string) => resolve(target))
}))

vi.mock('./filesystem-auth', () => ({ resolveAuthorizedPath: resolveAuthorizedPathMock }))

const store = {} as never
let root = ''
let outside = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-acp-terminal-root-'))
  outside = await mkdtemp(join(tmpdir(), 'orca-acp-terminal-outside-'))
  resolveAuthorizedPathMock
    .mockReset()
    .mockImplementation(async (target: string) => resolve(target))
})

afterEach(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ])
})

async function resolveDirectory(virtualCwd: string): Promise<string> {
  return resolveHermesAcpTerminalDirectory({ projectRoot: root, virtualCwd, store })
}

describe('resolveHermesAcpTerminalDirectory', () => {
  it('maps /workspace and its existing directory descendants into the approved root', async () => {
    await mkdir(join(root, 'src', 'nested'), { recursive: true })

    await expect(resolveDirectory('/workspace')).resolves.toBe(root)
    await expect(resolveDirectory('/workspace/src/nested')).resolves.toBe(
      join(root, 'src', 'nested')
    )
    expect(resolveAuthorizedPathMock).toHaveBeenLastCalledWith(join(root, 'src', 'nested'), store)
  })

  it.each([
    '',
    'workspace',
    '/outside',
    '/workspace/../outside',
    'C:\\workspace',
    '/workspace/name:stream',
    '/workspace/NUL',
    '/workspace/CONOUT$',
    '/workspace/COM¹.txt',
    '/workspace/trailing.',
    `/workspace/${'x'.repeat(4_097)}`
  ])('rejects an invalid or ambiguous virtual cwd: %s', async (virtualCwd) => {
    await expect(resolveDirectory(virtualCwd)).rejects.toThrow('ACP terminal cwd')
    expect(resolveAuthorizedPathMock).not.toHaveBeenCalled()
  })

  it('rejects files and canonical authorization results outside the project root', async () => {
    await writeFile(join(root, 'file.txt'), 'not a directory')
    await mkdir(join(root, 'redirected'))

    await expect(resolveDirectory('/workspace/file.txt')).rejects.toThrow(
      'not an approved project directory'
    )

    resolveAuthorizedPathMock.mockImplementation(async (target: string) =>
      target === join(root, 'redirected') ? outside : resolve(target)
    )
    await expect(resolveDirectory('/workspace/redirected')).rejects.toThrow(
      'not an approved project directory'
    )
  })

  it('rejects a symbolic-link or junction segment before authorization', async () => {
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(resolveDirectory('/workspace/linked')).rejects.toThrow(
      'cannot contain symbolic links'
    )
    expect(resolveAuthorizedPathMock).not.toHaveBeenCalled()
  })
})
