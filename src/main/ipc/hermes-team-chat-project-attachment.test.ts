import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'

const resolveAuthorizedPathMock = vi.hoisted(() => vi.fn())

vi.mock('./filesystem-auth', () => ({
  resolveAuthorizedPath: resolveAuthorizedPathMock
}))

import { attachTeamChatProjectFile } from './hermes-team-chat-project-attachment'

const temporaryDirectories: string[] = []

function xlsxFixture(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    )
  })
}

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-project-attachment-'))
  temporaryDirectories.push(root)
  resolveAuthorizedPathMock.mockImplementation((path: string) => realpath(path))
  return root
}

describe('attachTeamChatProjectFile', () => {
  it('reads an Explorer source file as a UTF-8 attachment', async () => {
    const root = await fixtureRoot()
    await writeFile(join(root, 'report.ts'), 'export const revenue = 42\n')
    const artifactStore = new HermesBinaryArtifactStore(join(root, 'artifacts'))

    const result = await attachTeamChatProjectFile({
      cwd: root,
      relativePath: 'report.ts',
      conversationId: 'conversation-one',
      store: {} as Store,
      artifactStore
    })

    expect(result.attachments).toEqual([
      { kind: 'text', name: 'report.ts', content: 'export const revenue = 42\n' }
    ])
    await artifactStore.close()
  })

  it('copies an Explorer workbook into the private artifact store', async () => {
    const root = await fixtureRoot()
    await writeFile(join(root, 'KPI.xlsx'), xlsxFixture())
    const artifactStore = new HermesBinaryArtifactStore(join(root, 'artifacts'))

    const result = await attachTeamChatProjectFile({
      cwd: root,
      relativePath: 'KPI.xlsx',
      conversationId: 'conversation-one',
      store: {} as Store,
      artifactStore
    })

    expect(result.attachments[0]).toMatchObject({
      kind: 'artifact',
      name: 'KPI.xlsx',
      artifactKind: 'xlsx'
    })
    await artifactStore.close()
  })

  it('rejects paths that leave the selected project', async () => {
    const root = await fixtureRoot()
    const artifactStore = new HermesBinaryArtifactStore(join(root, 'artifacts'))

    await expect(
      attachTeamChatProjectFile({
        cwd: root,
        relativePath: '../outside.xlsx',
        conversationId: 'conversation-one',
        store: {} as Store,
        artifactStore
      })
    ).rejects.toThrow('invalid project attachment path')
    await artifactStore.close()
  })
})
