import { createHash } from 'node:crypto'
import {
  chmod,
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FilesystemAuth from './filesystem-auth'
import { HermesAcpFilesystem } from './hermes-team-chat-acp-filesystem'
import { HERMES_ACP_OFFICE_PREVIEW_PREFIX } from './hermes-team-chat-acp-office-preview'

const { resolveAuthorizedPathMock } = vi.hoisted(() => ({
  resolveAuthorizedPathMock: vi.fn(async (path: string) => resolve(path))
}))

vi.mock('./filesystem-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof FilesystemAuth>()
  return { ...actual, resolveAuthorizedPath: resolveAuthorizedPathMock }
})

const store = {} as never
let root = ''
let backupRoot = ''
let temporaryPaths: string[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-acp-files-'))
  backupRoot = await mkdtemp(join(tmpdir(), 'orca-acp-backups-'))
  temporaryPaths = [root, backupRoot]
  resolveAuthorizedPathMock.mockReset().mockImplementation(async (path: string) => resolve(path))
})

afterEach(async () => {
  await Promise.all(temporaryPaths.map((path) => rm(path, { recursive: true, force: true })))
})

async function createFilesystem(
  customBackupRoot = backupRoot,
  officePreview: Parameters<typeof HermesAcpFilesystem.create>[0]['officePreview'] = null
): Promise<HermesAcpFilesystem> {
  return HermesAcpFilesystem.create({
    cwd: root,
    store,
    backupRoot: customBackupRoot,
    officePreview
  })
}

async function backupFiles(): Promise<string[]> {
  return (await readdir(backupRoot, { recursive: true }))
    .map(String)
    .filter((path) => path.endsWith('.bak'))
}

describe('HermesAcpFilesystem', () => {
  it('reads only virtual workspace paths with ACP line pagination', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'a.ts'), 'one\ntwo\nthree\n')
    const filesystem = await createFilesystem()

    await expect(
      filesystem.handle('fs/read_text_file', {
        path: '/workspace/src/a.ts',
        line: 2,
        limit: 2
      })
    ).resolves.toEqual({ content: 'two\nthree' })
    await expect(
      filesystem.handle('fs/read_text_file', { path: '/workspace/src/a.ts', line: 0 })
    ).rejects.toThrow('positive integer')
  })

  it('renders XLSX and PPTX reads as bounded visual preview payloads', async () => {
    await writeFile(join(root, 'report.xlsx'), 'office fixture')
    const render = vi.fn().mockResolvedValue({
      kind: 'xlsx',
      mediaType: 'image/png',
      imageBase64: 'aGVsbG8=',
      width: 800,
      height: 600,
      startIndex: 2,
      endIndex: 4,
      totalCount: 7,
      nextIndex: 5
    })
    const filesystem = await createFilesystem(backupRoot, {
      render,
      cancelAll: vi.fn()
    } as never)
    const signal = new AbortController().signal

    const result = (await filesystem.handle(
      'fs/read_text_file',
      {
        path: '/workspace/report.xlsx',
        line: 2,
        limit: 3,
        _meta: { samwoo: { officePreview: { version: 1 } } }
      },
      () => true,
      signal
    )) as { content: string; _meta: unknown }

    expect(render).toHaveBeenCalledWith({
      sourcePath: join(root, 'report.xlsx'),
      kind: 'xlsx',
      startIndex: 2,
      count: 3,
      signal
    })
    expect(result.content).toBe(
      `${HERMES_ACP_OFFICE_PREVIEW_PREFIX}${JSON.stringify({
        ...(await render.mock.results[0].value),
        sha256: createHash('sha256').update('office fixture').digest('hex')
      })}`
    )
    expect(result._meta).toEqual({ samwoo: { kind: 'office-preview', version: 1 } })
    await expect(
      filesystem.handle('fs/write_text_file', {
        path: '/workspace/report.xlsx',
        content: 'not binary'
      })
    ).rejects.toThrow('cannot be written')
  })

  it('rejects an Office preview when the source changes during rendering', async () => {
    const sourcePath = join(root, 'changing.xlsx')
    await writeFile(sourcePath, 'before')
    const render = vi.fn().mockImplementation(async () => {
      await writeFile(sourcePath, 'after')
      return {
        kind: 'xlsx',
        mediaType: 'image/png',
        imageBase64: 'aGVsbG8=',
        width: 800,
        height: 600,
        startIndex: 1,
        endIndex: 1,
        totalCount: 1,
        nextIndex: null
      }
    })
    const filesystem = await createFilesystem(backupRoot, {
      render,
      cancelAll: vi.fn()
    } as never)

    await expect(
      filesystem.handle('fs/read_text_file', {
        path: '/workspace/changing.xlsx',
        _meta: { samwoo: { officePreview: { version: 1 } } }
      })
    ).rejects.toThrow('office preview source changed while rendering')
  })

  it.each([
    { samwoo: { officePreview: { version: 1 } }, extra: true },
    { samwoo: { officePreview: { version: 1 }, extra: true } },
    { samwoo: { officePreview: { version: 1, extra: true } } }
  ])('requires the exact Office preview metadata shape: %j', async (_meta) => {
    await writeFile(join(root, 'report.xlsx'), 'office fixture')
    const filesystem = await createFilesystem(backupRoot, {
      render: vi.fn(),
      cancelAll: vi.fn()
    } as never)

    await expect(
      filesystem.handle('fs/read_text_file', { path: '/workspace/report.xlsx', _meta })
    ).rejects.toThrow('office preview request metadata is invalid')
  })

  it('reports a missing file without exposing the native project path', async () => {
    const filesystem = await createFilesystem()

    let message = ''
    try {
      await filesystem.handle('fs/read_text_file', { path: '/workspace/missing.txt' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toBe('file does not exist')
    expect(message).not.toContain(root)
  })

  it('creates a new file immediately after a not-found read', async () => {
    const filesystem = await createFilesystem()
    const path = '/workspace/hermes-smoke-test.txt'

    await expect(filesystem.handle('fs/read_text_file', { path })).rejects.toThrow(
      'file does not exist'
    )
    await expect(
      filesystem.handle('fs/write_text_file', { path, content: 'v1.4.213 smoke ok' })
    ).resolves.toBeNull()
    await expect(filesystem.handle('fs/read_text_file', { path })).resolves.toEqual({
      content: 'v1.4.213 smoke ok'
    })
  })

  it.each([
    '/outside/file.txt',
    '/workspace/../file.txt',
    'C:\\workspace\\file.txt',
    '/workspace/file.txt:stream',
    '/workspace/NUL',
    '/workspace/CONOUT$',
    '/workspace/COM¹.txt'
  ])('rejects a non-workspace or ambiguous wire path: %s', async (path) => {
    const filesystem = await createFilesystem()
    await expect(filesystem.handle('fs/read_text_file', { path })).rejects.toThrow()
  })

  it('rejects a canonical path that escapes the selected root', async () => {
    const outside = join(root, '..', `${basename(root)}-outside.txt`)
    await writeFile(outside, 'secret')
    temporaryPaths.push(outside)
    resolveAuthorizedPathMock.mockImplementation(async (path: string) =>
      path.endsWith(join('linked', 'outside.txt')) ? outside : resolve(path)
    )
    const filesystem = await createFilesystem()

    await expect(
      filesystem.handle('fs/read_text_file', { path: '/workspace/linked/outside.txt' })
    ).rejects.toThrow('outside the selected project')
  })

  it('requires a prior read and creates a byte-identical backup before overwrite', async () => {
    await writeFile(join(root, 'report.txt'), 'original')
    const filesystem = await createFilesystem()
    const writeParams = { path: '/workspace/report.txt', content: 'updated' }

    await expect(filesystem.handle('fs/write_text_file', writeParams)).rejects.toThrow(
      'read an existing file'
    )
    await filesystem.handle('fs/read_text_file', { path: '/workspace/report.txt' })
    await expect(filesystem.handle('fs/write_text_file', writeParams)).resolves.toBeNull()

    await expect(readFile(join(root, 'report.txt'), 'utf8')).resolves.toBe('updated')
    const backups = await backupFiles()
    expect(backups).toHaveLength(1)
    await expect(readFile(join(backupRoot, backups[0]), 'utf8')).resolves.toBe('original')
  })

  it('does not carry overwrite authorization into the next prompt turn', async () => {
    await writeFile(join(root, 'report.txt'), 'original')
    const filesystem = await createFilesystem()
    await filesystem.handle('fs/read_text_file', { path: '/workspace/report.txt' })
    filesystem.resetReadRevisions()

    await expect(
      filesystem.handle('fs/write_text_file', {
        path: '/workspace/report.txt',
        content: 'updated'
      })
    ).rejects.toThrow('read an existing file')
  })

  it('requires a full read before overwriting and supports empty files', async () => {
    await writeFile(join(root, 'report.txt'), 'one\ntwo')
    await writeFile(join(root, 'empty.txt'), '')
    const filesystem = await createFilesystem()

    await filesystem.handle('fs/read_text_file', {
      path: '/workspace/report.txt',
      line: 1,
      limit: 1
    })
    await expect(
      filesystem.handle('fs/write_text_file', {
        path: '/workspace/report.txt',
        content: 'updated'
      })
    ).rejects.toThrow('read an existing file')
    await expect(
      filesystem.handle('fs/read_text_file', { path: '/workspace/empty.txt' })
    ).resolves.toEqual({ content: '' })
    await expect(
      filesystem.handle('fs/write_text_file', {
        path: '/workspace/empty.txt',
        content: 'now populated'
      })
    ).resolves.toBeNull()
  })

  it('does not change the original when backup creation fails', async () => {
    await writeFile(join(root, 'report.txt'), 'original')
    const blockedBackupRoot = join(root, 'not-a-directory')
    await writeFile(blockedBackupRoot, 'file')
    const filesystem = await createFilesystem(blockedBackupRoot)
    await filesystem.handle('fs/read_text_file', { path: '/workspace/report.txt' })

    await expect(
      filesystem.handle('fs/write_text_file', {
        path: '/workspace/report.txt',
        content: 'updated'
      })
    ).rejects.toThrow('local filesystem operation failed')
    await expect(readFile(join(root, 'report.txt'), 'utf8')).resolves.toBe('original')
  })

  it.skipIf(process.platform === 'win32')(
    'preserves POSIX mode bits when replacing a file',
    async () => {
      const path = join(root, 'script.sh')
      await writeFile(path, '#!/bin/sh\n')
      await chmod(path, 0o700)
      const filesystem = await createFilesystem()
      await filesystem.handle('fs/read_text_file', { path: '/workspace/script.sh' })

      await filesystem.handle('fs/write_text_file', {
        path: '/workspace/script.sh',
        content: '#!/bin/sh\necho safe\n'
      })

      expect((await stat(path)).mode & 0o777).toBe(0o700)
    }
  )

  it('does not commit an existing or new file after its prompt is cancelled', async () => {
    await writeFile(join(root, 'report.txt'), 'original')
    const filesystem = await createFilesystem()
    await filesystem.handle('fs/read_text_file', { path: '/workspace/report.txt' })

    await expect(
      filesystem.handle(
        'fs/write_text_file',
        { path: '/workspace/report.txt', content: 'updated' },
        () => false
      )
    ).rejects.toThrow('ACP prompt was cancelled')
    await expect(
      filesystem.handle(
        'fs/write_text_file',
        { path: '/workspace/new.txt', content: 'new' },
        () => false
      )
    ).rejects.toThrow('ACP prompt was cancelled')
    await expect(readFile(join(root, 'report.txt'), 'utf8')).resolves.toBe('original')
    await expect(readFile(join(root, 'new.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains at most twenty backups for one file', async () => {
    await writeFile(join(root, 'report.txt'), 'original')
    const filesystem = await createFilesystem()
    await filesystem.handle('fs/read_text_file', { path: '/workspace/report.txt' })

    for (let index = 0; index < 22; index += 1) {
      await filesystem.handle('fs/write_text_file', {
        path: '/workspace/report.txt',
        content: `revision-${index}`
      })
    }

    expect(await backupFiles()).toHaveLength(20)
  })

  it('prunes backups older than thirty days before adding another', async () => {
    await writeFile(join(root, 'report.txt'), 'original')
    const filesystem = await createFilesystem()
    await filesystem.handle('fs/read_text_file', { path: '/workspace/report.txt' })
    await filesystem.handle('fs/write_text_file', {
      path: '/workspace/report.txt',
      content: 'revision-1'
    })
    const [backup] = await backupFiles()
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    await utimes(join(backupRoot, backup), old, old)

    await filesystem.handle('fs/write_text_file', {
      path: '/workspace/report.txt',
      content: 'revision-2'
    })

    expect(await backupFiles()).toHaveLength(1)
  })

  it('allows a new UTF-8 file without fabricating an original backup', async () => {
    const filesystem = await createFilesystem()
    await filesystem.handle('fs/write_text_file', {
      path: '/workspace/notes/new.txt',
      content: 'new'
    })

    await expect(readFile(join(root, 'notes', 'new.txt'), 'utf8')).resolves.toBe('new')
    expect(await backupFiles()).toEqual([])
  })

  it('rejects Git metadata and hard-linked files', async () => {
    await mkdir(join(root, '.git'))
    const source = join(root, 'source.txt')
    await writeFile(source, 'linked')
    await link(source, join(root, 'linked.txt'))
    const filesystem = await createFilesystem()

    await expect(
      filesystem.handle('fs/write_text_file', {
        path: '/workspace/.git/config',
        content: 'unsafe'
      })
    ).rejects.toThrow('Git metadata')
    await expect(
      filesystem.handle('fs/read_text_file', { path: '/workspace/linked.txt' })
    ).rejects.toThrow('not a supported file')
  })

  it('rejects paths that traverse an internal symlink or junction', async () => {
    await mkdir(join(root, 'target'))
    await writeFile(join(root, 'target', 'inside.txt'), 'content')
    await symlink(join(root, 'target'), join(root, 'linked'), 'junction')
    const filesystem = await createFilesystem()

    await expect(
      filesystem.handle('fs/read_text_file', { path: '/workspace/linked/inside.txt' })
    ).rejects.toThrow('symbolic links are not supported')
  })

  it('detects an external change after read and preserves both versions', async () => {
    const path = join(root, 'report.txt')
    await writeFile(path, 'original')
    const filesystem = await createFilesystem()
    await filesystem.handle('fs/read_text_file', { path: '/workspace/report.txt' })
    await writeFile(path, 'external')

    await expect(
      filesystem.handle('fs/write_text_file', {
        path: '/workspace/report.txt',
        content: 'agent'
      })
    ).rejects.toThrow('changed')
    await expect(readFile(path, 'utf8')).resolves.toBe('external')
    expect(await backupFiles()).toEqual([])
  })
})
