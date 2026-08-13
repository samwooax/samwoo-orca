import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { HermesBinaryArtifactStore } from './hermes-binary-artifact-store'

const temporaryDirectories: string[] = []

function xlsxFixture(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'
    )
  })
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('HermesBinaryArtifactStore', () => {
  it('binds admitted bytes to one conversation and request', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orca-artifacts-'))
    temporaryDirectories.push(parent)
    const store = new HermesBinaryArtifactStore(join(parent, 'store'))
    const artifact = await store.ingestBytes('KPI.xlsx', xlsxFixture(), 'conversation-one')

    expect(artifact).toMatchObject({ artifactKind: 'xlsx', name: 'KPI.xlsx' })
    await expect(
      store.read(artifact.artifactId, 'conversation-two', 'request-one')
    ).rejects.toThrow('unavailable for this conversation')
    await expect(
      store.read(artifact.artifactId, 'conversation-one', 'request-one')
    ).resolves.toEqual(Buffer.from(xlsxFixture()))
    await expect(
      store.read(artifact.artifactId, 'conversation-one', 'request-two')
    ).rejects.toThrow('already bound to another request')
    await store.close()
  })

  it('rejects extension spoofing and removes stale owned directories on startup', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'orca-artifacts-'))
    temporaryDirectories.push(parent)
    const root = join(parent, 'store')
    const stale = join(root, 'artifact-00000000-0000-4000-8000-000000000000')
    await mkdir(stale, { recursive: true })
    await writeFile(join(stale, 'payload'), 'stale')
    const store = new HermesBinaryArtifactStore(root)

    await expect(store.ingestBytes('spoof.pdf', xlsxFixture(), 'conversation')).rejects.toThrow(
      'extension does not match'
    )
    await expect(access(stale)).rejects.toThrow()
    await store.close()
  })
})
