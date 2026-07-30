import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installBundledSkillGuides } from './bundled-skill-installer'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('bundled skill installer', () => {
  it('writes version-matched guides without Node.js or npx', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca bundled skills '))
    temporaryRoots.push(root)
    const roots = [join(root, '.agents', 'skills'), join(root, '.codex', 'skills')]

    const result = await installBundledSkillGuides(
      [
        { name: 'orca-cli', markdown: '---\nname: orca-cli\n---\n\n# Orca CLI\n' },
        { name: 'orchestration', markdown: '---\nname: orchestration\n---\n\n# Orchestration\n' }
      ],
      roots
    )

    expect(result.names).toEqual(['orca-cli', 'orchestration'])
    expect(result.paths).toHaveLength(4)
    await expect(
      readFile(join(root, '.codex', 'skills', 'orchestration', 'SKILL.md'), 'utf8')
    ).resolves.toContain('# Orchestration')
  })
})
