import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getExcelArtifactCapabilityMock, resolveTeamChatProjectDirectoryMock } = vi.hoisted(() => ({
  getExcelArtifactCapabilityMock: vi.fn(),
  resolveTeamChatProjectDirectoryMock: vi.fn()
}))

vi.mock('./hermes-excel-artifact-worker-client', () => ({
  getExcelArtifactCapability: getExcelArtifactCapabilityMock
}))
vi.mock('./hermes-team-chat-project-directory', () => ({
  resolveTeamChatProjectDirectory: resolveTeamChatProjectDirectoryMock
}))

import { resolveTeamChatExcelArtifactCapability } from './hermes-team-chat-excel-capability'

const capability = { name: 'excelArtifact' as const }

beforeEach(() => {
  getExcelArtifactCapabilityMock.mockReset().mockResolvedValue(capability)
  resolveTeamChatProjectDirectoryMock.mockReset().mockResolvedValue('C:\\project')
})

describe('resolveTeamChatExcelArtifactCapability', () => {
  it('returns the bundled capability for an authorized native project', async () => {
    await expect(resolveTeamChatExcelArtifactCapability('C:\\project', {} as never)).resolves.toBe(
      capability
    )
  })

  it('does not expose the Windows worker to a WSL project', async () => {
    await expect(
      resolveTeamChatExcelArtifactCapability(
        '\\\\wsl.localhost\\Ubuntu\\home\\me\\project',
        {} as never
      )
    ).resolves.toBeNull()
    expect(getExcelArtifactCapabilityMock).not.toHaveBeenCalled()
  })

  it('rejects an authorized root that resolves into WSL', async () => {
    resolveTeamChatProjectDirectoryMock.mockResolvedValue('\\\\wsl$\\Ubuntu\\home\\me\\project')

    await expect(
      resolveTeamChatExcelArtifactCapability('C:\\project-link', {} as never)
    ).resolves.toBeNull()
  })
})
