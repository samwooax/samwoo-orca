import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'

const mocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(() => null),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  dialog: { showOpenDialog: mocks.showOpenDialog }
}))

import { pickTeamChatAttachments } from './hermes-team-chat-attachment-picker'

const temporaryDirectories: string[] = []

async function pick(paths: string[], artifactStore: HermesBinaryArtifactStore = {} as never) {
  mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: paths })
  return pickTeamChatAttachments({
    event: { sender: {} } as IpcMainInvokeEvent,
    conversationId: 'conversation-one',
    remainingSlots: 5,
    artifactStore
  })
}

beforeEach(() => {
  mocks.fromWebContents.mockClear()
  mocks.showOpenDialog.mockReset()
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('pickTeamChatAttachments', () => {
  it('accepts HTML and arbitrary UTF-8 text from the native picker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-team-chat-picker-'))
    temporaryDirectories.push(root)
    const html = join(root, 'report.HTML')
    const source = join(root, 'component.tsx')
    await writeFile(html, '<h1>Quarterly report</h1>\n')
    await writeFile(source, 'export const total = 42\n')

    await expect(pick([html, source])).resolves.toMatchObject({
      cancelled: false,
      attachments: [
        { kind: 'text', name: 'report.HTML', content: '<h1>Quarterly report</h1>\n' },
        { kind: 'text', name: 'component.tsx', content: 'export const total = 42\n' }
      ],
      rejected: []
    })
    expect(mocks.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ extensions: expect.arrayContaining(['html', 'htm']) }),
          { name: 'All files', extensions: ['*'] }
        ])
      })
    )
  })

  it('rejects malformed and oversized text without accepting partial content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-team-chat-picker-'))
    temporaryDirectories.push(root)
    const malformed = join(root, 'malformed.html')
    const binaryText = join(root, 'binary.txt')
    const oversized = join(root, 'oversized.txt')
    await writeFile(malformed, Buffer.from([0xc3, 0x28]))
    await writeFile(binaryText, Buffer.from('hello\0world'))
    await writeFile(oversized, 'a'.repeat(96_001))

    await expect(pick([malformed, binaryText, oversized])).resolves.toEqual({
      cancelled: false,
      attachments: [],
      rejected: ['malformed.html', 'binary.txt', 'oversized.txt']
    })
  })

  it('keeps reserved binary extensions on the artifact path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-team-chat-picker-'))
    temporaryDirectories.push(root)
    const pdf = join(root, 'report.pdf')
    await writeFile(pdf, 'valid UTF-8 but reserved as a binary document')
    const artifact = {
      kind: 'artifact' as const,
      artifactId: 'artifact-00000000-0000-4000-8000-000000000001',
      name: 'report.pdf',
      artifactKind: 'pdf' as const,
      mimeType: 'application/pdf',
      sizeBytes: 44,
      sha256: 'a'.repeat(64)
    }
    const artifactStore = { ingestFile: vi.fn().mockResolvedValue(artifact) }

    await expect(pick([pdf], artifactStore as never)).resolves.toMatchObject({
      attachments: [artifact],
      rejected: []
    })
    expect(artifactStore.ingestFile).toHaveBeenCalledWith(pdf, 'conversation-one')
  })
})
