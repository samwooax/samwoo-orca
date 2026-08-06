import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'
import { isSamwooWorkspacePathSupported } from './samwoo-workspace-file-policy'
import { previewSamwooWorkspaceFiles } from './samwoo-workspace-file-preview'
import { pullSamwooWorkspaceFiles, pushSamwooWorkspaceFiles } from './samwoo-workspace-file-sync'
import { resolveSamwooWorkspaceConflicts } from './samwoo-workspace-conflict-resolution'

vi.mock('electron', () => ({
  app: { getPath: () => testRoot },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('./samwoo-workspace-share-client', () => ({ postSamwooWorkspaceShare: vi.fn() }))

const TOKEN = 'token-owner-0123456789'
const SHARE_ID = '123e4567-e89b-42d3-a456-426614174000'
let testRoot = ''

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'samwoo-workspace-sync-'))
  vi.mocked(postSamwooWorkspaceShare).mockReset()
})

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true })
})

describe('SAMWOO workspace file sync', () => {
  it('uploads project files while excluding generated, secret, and symlink content', async () => {
    const sourcePath = path.join(testRoot, 'source')
    await fs.mkdir(path.join(sourcePath, '.git'), { recursive: true })
    await fs.mkdir(path.join(sourcePath, 'node_modules'), { recursive: true })
    await fs.mkdir(path.join(sourcePath, 'src'), { recursive: true })
    await fs.writeFile(path.join(sourcePath, '.git', 'config'), 'secret')
    await fs.writeFile(path.join(sourcePath, 'node_modules', 'package.js'), 'dependency')
    await fs.writeFile(path.join(sourcePath, 'src', 'index.ts'), 'export {}')
    await fs.writeFile(path.join(sourcePath, '.env'), 'API_TOKEN=secret')
    await fs.writeFile(path.join(sourcePath, 'private.key'), 'secret')
    if (process.platform !== 'win32') {
      await fs.symlink(path.join(sourcePath, 'src'), path.join(sourcePath, 'linked-src'))
    }
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route) => {
      if (route.endsWith('/list')) {
        return { ok: true, entries: [] }
      }
      return {
        ok: true,
        file: { path: 'src/index.ts', contentBase64: '', etag: 'etag-1', size: 9 }
      }
    })

    const result = await pushSamwooWorkspaceFiles({
      token: TOKEN,
      shareId: SHARE_ID,
      sourcePath
    })

    expect(result).toMatchObject({ ok: true, transferredFiles: 1 })
    const writeCall = vi
      .mocked(postSamwooWorkspaceShare)
      .mock.calls.find(([route]) => route.endsWith('/write'))
    expect(writeCall?.[2]).toMatchObject({
      path: 'src/index.ts',
      createOnly: true
    })
  })

  it('excludes a Git worktree metadata file as well as a Git directory', async () => {
    const sourcePath = path.join(testRoot, 'worktree')
    await fs.mkdir(sourcePath)
    await fs.writeFile(path.join(sourcePath, '.git'), 'gitdir: ../.git/worktrees/feature')
    await fs.writeFile(path.join(sourcePath, 'README.md'), 'safe')
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route) => {
      if (route.endsWith('/list')) {
        return { ok: true, entries: [] }
      }
      return {
        ok: true,
        file: { path: 'README.md', contentBase64: '', etag: 'etag-1', size: 4 }
      }
    })

    await pushSamwooWorkspaceFiles({ token: TOKEN, shareId: SHARE_ID, sourcePath })

    const writeCall = vi
      .mocked(postSamwooWorkspaceShare)
      .mock.calls.find(([route]) => route.endsWith('/write'))
    expect(writeCall?.[2]).toMatchObject({
      path: 'README.md'
    })
  })

  it('persists each uploaded file so a partial failure resumes safely', async () => {
    const sourcePath = path.join(testRoot, 'partial')
    await fs.mkdir(sourcePath)
    await fs.writeFile(path.join(sourcePath, 'a.txt'), 'first')
    await fs.writeFile(path.join(sourcePath, 'b.txt'), 'second')
    vi.mocked(postSamwooWorkspaceShare).mockImplementationOnce(async () => ({
      ok: true,
      entries: []
    }))
    vi.mocked(postSamwooWorkspaceShare)
      .mockResolvedValueOnce({
        ok: true,
        file: { path: 'a.txt', contentBase64: '', etag: 'etag-a', size: 5 }
      })
      .mockResolvedValueOnce({ ok: false, error: 'temporary failure' })

    await expect(
      pushSamwooWorkspaceFiles({ token: TOKEN, shareId: SHARE_ID, sourcePath })
    ).rejects.toThrow('temporary failure')
    vi.mocked(postSamwooWorkspaceShare).mockReset()
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route) => {
      if (route.endsWith('/list')) {
        return {
          ok: true,
          entries: [{ name: 'a.txt', kind: 'file', size: 5, etag: 'etag-a' }]
        }
      }
      return {
        ok: true,
        file: { path: 'b.txt', contentBase64: '', etag: 'etag-b', size: 6 }
      }
    })

    const retry = await pushSamwooWorkspaceFiles({ token: TOKEN, shareId: SHARE_ID, sourcePath })

    expect(retry).toMatchObject({ ok: true, transferredFiles: 1, skippedFiles: 1 })
    const writeCalls = vi
      .mocked(postSamwooWorkspaceShare)
      .mock.calls.filter(([route]) => route.endsWith('/write'))
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]?.[2]).toMatchObject({ path: 'b.txt' })
  })

  it('reports a create-only upload conflict without overwriting the remote file', async () => {
    const sourcePath = path.join(testRoot, 'conflict')
    await fs.mkdir(sourcePath)
    await fs.writeFile(path.join(sourcePath, 'note.txt'), 'local')
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route) => {
      if (route.endsWith('/list')) {
        return {
          ok: true,
          entries: [{ name: 'note.txt', kind: 'file', size: 6, etag: 'remote' }]
        }
      }
      return { ok: false, errorCode: 'file_conflict', error: 'changed' }
    })

    const result = await pushSamwooWorkspaceFiles({ token: TOKEN, shareId: SHARE_ID, sourcePath })

    expect(result).toMatchObject({ ok: true, transferredFiles: 0, conflicts: ['note.txt'] })
    const writeCall = vi
      .mocked(postSamwooWorkspaceShare)
      .mock.calls.find(([route]) => route.endsWith('/write'))
    expect(writeCall?.[2]).toMatchObject({
      path: 'note.txt',
      createOnly: true
    })
  })

  it('identifies file names that cannot be created on Windows', () => {
    expect(isSamwooWorkspacePathSupported('reports/summary.txt', 'win32')).toBe(true)
    expect(isSamwooWorkspacePathSupported('reports/CON.txt', 'win32')).toBe(false)
    expect(isSamwooWorkspacePathSupported('reports/trailing. ', 'win32')).toBe(false)
    expect(isSamwooWorkspacePathSupported('reports/question?.txt', 'win32')).toBe(false)
  })

  it('deletes a confirmed local removal from Nextcloud with its tracked ETag', async () => {
    const sourcePath = path.join(testRoot, 'delete-push')
    await fs.mkdir(sourcePath)
    await fs.writeFile(path.join(sourcePath, 'old.txt'), 'old')
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route) => {
      if (route.endsWith('/list')) {
        return { ok: true, entries: [] }
      }
      return {
        ok: true,
        file: { path: 'old.txt', contentBase64: '', etag: 'etag-old', size: 3 }
      }
    })
    await pushSamwooWorkspaceFiles({ token: TOKEN, shareId: SHARE_ID, sourcePath })
    await fs.rm(path.join(sourcePath, 'old.txt'))
    vi.mocked(postSamwooWorkspaceShare).mockReset()
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route) => {
      if (route.endsWith('/list')) {
        return {
          ok: true,
          entries: [{ name: 'old.txt', kind: 'file', size: 3, etag: 'etag-old' }]
        }
      }
      return { ok: true }
    })

    const preview = await previewSamwooWorkspaceFiles({
      token: TOKEN,
      shareId: SHARE_ID,
      direction: 'push',
      localPath: sourcePath
    })
    const result = await pushSamwooWorkspaceFiles({
      token: TOKEN,
      shareId: SHARE_ID,
      sourcePath,
      deletePaths: ['old.txt']
    })

    expect(preview.changes).toEqual([{ path: 'old.txt', kind: 'delete', origin: 'local' }])
    expect(result).toMatchObject({ ok: true, transferredFiles: 1 })
    const deleteCall = vi
      .mocked(postSamwooWorkspaceShare)
      .mock.calls.find(([route]) => route.endsWith('/delete'))
    expect(deleteCall?.[2]).toMatchObject({ path: 'old.txt', expectedEtag: 'etag-old' })
  })

  it('removes an unchanged local file only after a confirmed cloud deletion', async () => {
    const destinationPath = path.join(testRoot, 'delete-pull')
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route) => {
      if (route.endsWith('/list')) {
        return {
          ok: true,
          entries: [{ name: 'old.txt', kind: 'file', size: 3, etag: 'etag-old' }]
        }
      }
      return {
        ok: true,
        file: {
          path: 'old.txt',
          contentBase64: Buffer.from('old').toString('base64'),
          etag: 'etag-old',
          size: 3
        }
      }
    })
    await pullSamwooWorkspaceFiles({ token: TOKEN, shareId: SHARE_ID, destinationPath })
    vi.mocked(postSamwooWorkspaceShare).mockReset()
    vi.mocked(postSamwooWorkspaceShare).mockResolvedValue({ ok: true, entries: [] })

    const preview = await previewSamwooWorkspaceFiles({
      token: TOKEN,
      shareId: SHARE_ID,
      direction: 'pull',
      localPath: destinationPath
    })
    await pullSamwooWorkspaceFiles({
      token: TOKEN,
      shareId: SHARE_ID,
      destinationPath
    })
    expect(await fs.readFile(path.join(destinationPath, 'old.txt'), 'utf8')).toBe('old')
    await pullSamwooWorkspaceFiles({
      token: TOKEN,
      shareId: SHARE_ID,
      destinationPath,
      deletePaths: ['old.txt']
    })

    expect(preview.changes).toEqual([{ path: 'old.txt', kind: 'delete', origin: 'remote' }])
    await expect(fs.stat(path.join(destinationPath, 'old.txt'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('keeps both conflict versions and restores the cloud file as canonical', async () => {
    const localPath = path.join(testRoot, 'resolve-both')
    await fs.mkdir(localPath)
    await fs.writeFile(path.join(localPath, 'note.txt'), 'local version')
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route, _token, body) => {
      if (route.endsWith('/list')) {
        return {
          ok: true,
          entries: [{ name: 'note.txt', kind: 'file', size: 13, etag: 'cloud-etag' }]
        }
      }
      if (route.endsWith('/read')) {
        return {
          ok: true,
          file: {
            path: 'note.txt',
            contentBase64: Buffer.from('cloud version').toString('base64'),
            etag: 'cloud-etag',
            size: 13
          }
        }
      }
      return {
        ok: true,
        file: {
          path: String(body?.path),
          contentBase64: '',
          etag: 'copy-etag',
          size: 13
        }
      }
    })

    const result = await resolveSamwooWorkspaceConflicts({
      token: TOKEN,
      shareId: SHARE_ID,
      localPath,
      direction: 'pull',
      resolutions: [{ path: 'note.txt', choice: 'keep_both' }]
    })

    expect(result).toMatchObject({ ok: true, transferredFiles: 1, conflicts: [] })
    expect(await fs.readFile(path.join(localPath, 'note.txt'), 'utf8')).toBe('cloud version')
    const files = await fs.readdir(localPath)
    const copyName = files.find((name) => name.startsWith('note.local-'))
    expect(copyName).toBeTruthy()
    expect(await fs.readFile(path.join(localPath, copyName ?? ''), 'utf8')).toBe('local version')
  })

  it('preserves a locally edited file when the cloud ETag has changed', async () => {
    const destinationPath = path.join(testRoot, 'download')
    let etag = 'etag-1'
    vi.mocked(postSamwooWorkspaceShare).mockImplementation(async (route) => {
      if (route.endsWith('/list')) {
        return { ok: true, entries: [{ name: 'note.txt', kind: 'file', size: 6, etag }] }
      }
      return {
        ok: true,
        file: {
          path: 'note.txt',
          contentBase64: Buffer.from(etag === 'etag-1' ? 'cloud1' : 'cloud2').toString('base64'),
          etag,
          size: 6
        }
      }
    })
    await pullSamwooWorkspaceFiles({ token: TOKEN, shareId: SHARE_ID, destinationPath })
    await fs.writeFile(path.join(destinationPath, 'note.txt'), 'local edit')
    etag = 'etag-2'

    const result = await pullSamwooWorkspaceFiles({
      token: TOKEN,
      shareId: SHARE_ID,
      destinationPath
    })

    expect(result.conflicts).toEqual(['note.txt'])
    expect(await fs.readFile(path.join(destinationPath, 'note.txt'), 'utf8')).toBe('local edit')
  })

  it('rejects a server file name that escapes the destination', async () => {
    vi.mocked(postSamwooWorkspaceShare).mockResolvedValue({
      ok: true,
      entries: [{ name: '../escape.txt', kind: 'file', size: 1, etag: 'etag' }]
    })

    await expect(
      pullSamwooWorkspaceFiles({
        token: TOKEN,
        shareId: SHARE_ID,
        destinationPath: path.join(testRoot, 'download')
      })
    ).rejects.toThrow('invalid file path')
  })
})
