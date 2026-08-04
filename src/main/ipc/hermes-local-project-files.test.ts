import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatLocalFileResults,
  parseLocalFileRequest,
  type LocalFileRequest
} from './hermes-local-file-protocol'
import { executeLocalFileRequest } from './hermes-local-project-files'

const { resolveAuthorizedPathMock } = vi.hoisted(() => ({
  resolveAuthorizedPathMock: vi.fn(async (path: string) => path)
}))

vi.mock('./filesystem-auth', () => ({
  resolveAuthorizedPath: resolveAuthorizedPathMock
}))

const store = {} as never
let root = ''
let temporaryPaths: string[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-local-files-'))
  temporaryPaths = [root]
  resolveAuthorizedPathMock.mockReset().mockImplementation(async (path: string) => path)
})

afterEach(async () => {
  await Promise.all(temporaryPaths.map((path) => rm(path, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

function request(operations: LocalFileRequest['operations']): LocalFileRequest {
  return { version: 1, operations }
}

describe('parseLocalFileRequest', () => {
  it('accepts only an exact, valid tool envelope', () => {
    const valid =
      '<orca_local_files>{"version":1,"operations":[{"id":"one","kind":"read","path":"src/a.ts"}]}</orca_local_files>'
    expect(parseLocalFileRequest(valid)?.operations).toEqual([
      { id: 'one', kind: 'read', path: 'src/a.ts' }
    ])
    expect(parseLocalFileRequest(`설명\n${valid}`)).toBeNull()
    expect(
      parseLocalFileRequest(
        '<orca_local_files>{"version":1,"operations":[{"id":"one","kind":"delete","path":"a"}]}</orca_local_files>'
      )
    ).toBeNull()
  })

  it('rejects duplicate operation ids and oversized batches', () => {
    const duplicate =
      '<orca_local_files>{"version":1,"operations":[{"id":"x","kind":"list","path":"."},{"id":"x","kind":"read","path":"a"}]}</orca_local_files>'
    expect(parseLocalFileRequest(duplicate)).toBeNull()
    const operations = Array.from({ length: 9 }, (_, index) => ({
      id: `x${index}`,
      kind: 'list',
      path: '.'
    }))
    expect(
      parseLocalFileRequest(
        `<orca_local_files>${JSON.stringify({ version: 1, operations })}</orca_local_files>`
      )
    ).toBeNull()
  })
})

describe('executeLocalFileRequest', () => {
  it('lists and reads files with a content hash', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'a.ts'), 'hello')
    const results = await executeLocalFileRequest({
      cwd: root,
      store,
      request: request([
        { id: 'list', kind: 'list', path: 'src' },
        { id: 'read', kind: 'read', path: 'src/a.ts' }
      ])
    })

    expect(results[0]).toMatchObject({
      id: 'list',
      ok: true,
      entries: [{ name: 'a.ts', type: 'file' }]
    })
    expect(results[1]).toMatchObject({
      id: 'read',
      ok: true,
      contentBase64: Buffer.from('hello').toString('base64'),
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    })
  })

  it('creates a file only when it does not already exist', async () => {
    const creation = {
      id: 'create',
      kind: 'write' as const,
      path: 'notes/new.txt',
      contentBase64: Buffer.from('new').toString('base64'),
      expectedSha256: null
    }
    const [created] = await executeLocalFileRequest({
      cwd: root,
      store,
      request: request([creation])
    })
    const [rejected] = await executeLocalFileRequest({
      cwd: root,
      store,
      request: request([creation])
    })

    expect(created.ok).toBe(true)
    expect(rejected).toMatchObject({ ok: false, error: expect.stringContaining('already exists') })
    await expect(readFile(join(root, 'notes', 'new.txt'), 'utf8')).resolves.toBe('new')
  })

  it('requires the current hash before replacing an existing file', async () => {
    const path = join(root, 'report.txt')
    await writeFile(path, 'current')
    const [rejected] = await executeLocalFileRequest({
      cwd: root,
      store,
      request: request([
        {
          id: 'write',
          kind: 'write',
          path: 'report.txt',
          contentBase64: Buffer.from('replacement').toString('base64'),
          expectedSha256: '0'.repeat(64)
        }
      ])
    })

    expect(rejected.ok).toBe(false)
    await expect(readFile(path, 'utf8')).resolves.toBe('current')
  })

  it('rejects writes anywhere inside Git metadata', async () => {
    for (const path of ['.git/hooks/pre-commit', 'nested/.GIT/config']) {
      const [result] = await executeLocalFileRequest({
        cwd: root,
        store,
        request: request([
          {
            id: path,
            kind: 'write',
            path,
            contentBase64: Buffer.from('malicious').toString('base64'),
            expectedSha256: null
          }
        ])
      })
      expect(result).toMatchObject({
        ok: false,
        error: 'writing Git metadata is not allowed'
      })
    }
  })

  it('rejects writes whose canonical path resolves inside Git metadata', async () => {
    resolveAuthorizedPathMock.mockImplementation(async (path: string) =>
      path.endsWith(join('gitdir', 'hooks', 'pre-commit'))
        ? join(root, '.git', 'hooks', 'pre-commit')
        : path
    )
    const [result] = await executeLocalFileRequest({
      cwd: root,
      store,
      request: request([
        {
          id: 'symlinked-git',
          kind: 'write',
          path: 'gitdir/hooks/pre-commit',
          contentBase64: Buffer.from('malicious').toString('base64'),
          expectedSha256: null
        }
      ])
    })

    expect(result).toMatchObject({
      ok: false,
      error: 'writing Git metadata is not allowed'
    })
  })

  it('serializes writes so two requests cannot both replace the same version', async () => {
    const path = join(root, 'report.txt')
    await writeFile(path, 'current')
    const expectedSha256 = '97b0560280ed60a5a1eaa1bc45492543c8a986ad5a25b468c427eb83c3e88191'
    const replacements = ['first', 'second'].map((content, index) =>
      executeLocalFileRequest({
        cwd: root,
        store,
        request: request([
          {
            id: `write-${index}`,
            kind: 'write',
            path: 'report.txt',
            contentBase64: Buffer.from(content).toString('base64'),
            expectedSha256
          }
        ])
      })
    )
    const results = (await Promise.all(replacements)).flat()

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    expect(['first', 'second']).toContain(await readFile(path, 'utf8'))
  })

  it('rejects traversal even when another path would otherwise be authorized', async () => {
    const [result] = await executeLocalFileRequest({
      cwd: root,
      store,
      request: request([{ id: 'read', kind: 'read', path: '../outside.txt' }])
    })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('traversal') })
  })

  it('requires an explicitly selected project', async () => {
    await expect(
      executeLocalFileRequest({
        cwd: '',
        store,
        request: request([{ id: 'list', kind: 'list', path: '.' }])
      })
    ).rejects.toThrow('no local project is selected')
  })

  it('rejects a canonical target outside the selected project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'orca-local-outside-'))
    temporaryPaths.push(outside)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    resolveAuthorizedPathMock.mockImplementation(async (path: string) =>
      path.endsWith(join('linked', 'secret.txt')) ? join(outside, 'secret.txt') : path
    )
    const [result] = await executeLocalFileRequest({
      cwd: root,
      store,
      request: request([{ id: 'read', kind: 'read', path: 'linked/secret.txt' }])
    })
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('outside the selected project')
    })
  })

  it('formats results as a dedicated tool envelope', () => {
    expect(formatLocalFileResults([{ id: 'x', ok: true }])).toBe(
      '<orca_local_file_results>{"version":1,"results":[{"id":"x","ok":true}]}</orca_local_file_results>'
    )
  })
})
