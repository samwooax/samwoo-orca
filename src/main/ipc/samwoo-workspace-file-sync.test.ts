import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postSamwooWorkspaceShare } from './samwoo-workspace-share-client'
import { pullSamwooWorkspaceFiles, pushSamwooWorkspaceFiles } from './samwoo-workspace-file-sync'

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
    vi.mocked(postSamwooWorkspaceShare).mockResolvedValue({
      ok: true,
      file: { path: 'src/index.ts', contentBase64: '', etag: 'etag-1', size: 9 }
    })

    const result = await pushSamwooWorkspaceFiles({
      token: TOKEN,
      shareId: SHARE_ID,
      sourcePath
    })

    expect(result).toMatchObject({ ok: true, transferredFiles: 1 })
    expect(postSamwooWorkspaceShare).toHaveBeenCalledOnce()
    expect(vi.mocked(postSamwooWorkspaceShare).mock.calls[0]?.[2]).toMatchObject({
      path: 'src/index.ts'
    })
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
