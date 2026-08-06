import { describe, expect, it, vi } from 'vitest'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import { createSharedWorkspaceWithUpload } from './create-shared-workspace-with-upload'

const share: SamwooWorkspaceShare = {
  id: '78c7dd40-3796-4b35-aeca-8427a91f777e',
  ownerLogin: 'owner',
  ownerProfile: 'ai_center',
  displayName: 'Project Alpha',
  permission: 'contribute',
  createdAt: 1,
  updatedAt: 1,
  isOwner: true,
  commentCount: 0
}

describe('createSharedWorkspaceWithUpload', () => {
  it('uploads the selected project immediately after creating its share', async () => {
    const order: string[] = []
    const create = vi.fn(async () => {
      order.push('create')
      return { ok: true, share }
    })
    const pushFiles = vi.fn(async () => {
      order.push('upload')
      return { ok: true, transferredFiles: 12, skippedFiles: 1 }
    })
    const onUploadStart = vi.fn(() => order.push('upload-start'))

    await expect(
      createSharedWorkspaceWithUpload({
        api: { create, pushFiles },
        token: 'session-token-long-enough',
        displayName: 'Project Alpha',
        permission: 'contribute',
        sourcePath: 'C:\\Work\\Project Alpha',
        onUploadStart
      })
    ).resolves.toEqual({
      ok: true,
      share,
      transferredFiles: 12,
      skippedFiles: 1
    })
    expect(order).toEqual(['create', 'upload-start', 'upload'])
    expect(pushFiles).toHaveBeenCalledWith({
      token: 'session-token-long-enough',
      shareId: share.id,
      sourcePath: 'C:\\Work\\Project Alpha'
    })
  })

  it('does not upload when share creation fails', async () => {
    const pushFiles = vi.fn()
    const result = await createSharedWorkspaceWithUpload({
      api: {
        create: vi.fn(async () => ({ ok: false, error: 'invalid or expired session' })),
        pushFiles
      },
      token: 'session-token-long-enough',
      displayName: 'Project Alpha',
      permission: 'download',
      sourcePath: '/work/project-alpha'
    })

    expect(result).toEqual({
      ok: false,
      phase: 'create',
      error: 'invalid or expired session'
    })
    expect(pushFiles).not.toHaveBeenCalled()
  })

  it('does not upload when the server omits the created share', async () => {
    const pushFiles = vi.fn()
    const result = await createSharedWorkspaceWithUpload({
      api: {
        create: vi.fn(async () => ({ ok: true })),
        pushFiles
      },
      token: 'session-token-long-enough',
      displayName: 'Project Alpha',
      permission: 'download',
      sourcePath: '/work/project-alpha'
    })

    expect(result).toEqual({
      ok: false,
      phase: 'create',
      error: 'Share server returned no workspace.'
    })
    expect(pushFiles).not.toHaveBeenCalled()
  })

  it('returns the created share when initial upload fails so the UI can preserve retry state', async () => {
    const result = await createSharedWorkspaceWithUpload({
      api: {
        create: vi.fn(async () => ({ ok: true, share })),
        pushFiles: vi.fn(async () => ({
          ok: false,
          error: 'Nextcloud unavailable',
          conflicts: ['README.md']
        }))
      },
      token: 'session-token-long-enough',
      displayName: 'Project Alpha',
      permission: 'download',
      sourcePath: '/work/project-alpha'
    })

    expect(result).toEqual({
      ok: false,
      phase: 'upload',
      share,
      error: 'Nextcloud unavailable',
      conflicts: ['README.md']
    })
  })
})
