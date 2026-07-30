import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

type InstallableSkillGuide = {
  name: string
  markdown: string
}

export type BundledSkillInstallResult = {
  names: string[]
  paths: string[]
}

export function bundledSkillHomeRoots(homePath = homedir()): string[] {
  return [
    join(homePath, '.agents', 'skills'),
    join(homePath, '.codex', 'skills'),
    join(homePath, '.claude', 'skills'),
    join(homePath, '.grok', 'skills'),
    join(homePath, '.config', 'opencode', 'skills'),
    join(homePath, '.pi', 'agent', 'skills'),
    join(homePath, '.gemini', 'skills'),
    join(homePath, '.gemini', 'antigravity', 'skills'),
    join(homePath, '.cursor', 'skills')
  ]
}

export async function installBundledSkillGuides(
  guides: readonly InstallableSkillGuide[],
  roots = bundledSkillHomeRoots()
): Promise<BundledSkillInstallResult> {
  const paths: string[] = []
  for (const root of roots) {
    for (const guide of guides) {
      const skillDirectory = join(root, guide.name)
      const skillPath = join(skillDirectory, 'SKILL.md')
      await mkdir(skillDirectory, { recursive: true })
      await writeFile(skillPath, guide.markdown, 'utf8')
      paths.push(skillPath)
    }
  }
  return {
    names: guides.map((guide) => guide.name),
    paths
  }
}
