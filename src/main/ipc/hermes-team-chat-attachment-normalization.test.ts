import { describe, expect, it, vi } from 'vitest'
import {
  normalizeTeamChatAttachments,
  prepareTeamChatAttachments
} from './hermes-team-chat-attachment-normalization'

describe('Hermes team chat document attachments', () => {
  it('normalizes legacy XLSX bytes and exposes only an artifact-backed virtual path', async () => {
    const attachments = normalizeTeamChatAttachments([
      { kind: 'document', name: 'KPI.xlsx', contentBase64: 'UEsDBA==' },
      { kind: 'text', name: 'notes.txt', content: 'translate this' }
    ])
    const artifactStore = {
      ingestBytes: vi.fn().mockResolvedValue({
        kind: 'artifact',
        artifactId: 'artifact-00000000-0000-4000-8000-000000000000',
        name: 'KPI.xlsx',
        artifactKind: 'xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 4,
        sha256: 'a'.repeat(64)
      })
    }
    const prepared = await prepareTeamChatAttachments({
      message: '번역해 줘',
      attachments,
      conversationId: 'conversation',
      requestId: 'request',
      artifactStore: artifactStore as never
    })

    expect(prepared.message).toContain('Orca 문서 도구 경로: @attachments/1-KPI.xlsx')
    expect(prepared.message).toContain('[첨부 파일: notes.txt]')
    expect(prepared.message).not.toContain('UEsDBA==')
    expect(prepared.documents).toEqual([
      {
        path: '@attachments/1-KPI.xlsx',
        artifactId: 'artifact-00000000-0000-4000-8000-000000000000'
      }
    ])
    expect(prepared.reusableArtifactIds).toEqual([])
    expect(prepared.ephemeralArtifactIds).toEqual(['artifact-00000000-0000-4000-8000-000000000000'])
  })

  it('keeps admitted artifacts reusable after each request releases its binding', async () => {
    const artifact = {
      kind: 'artifact' as const,
      artifactId: 'artifact-00000000-0000-4000-8000-000000000001',
      name: 'KPI.xlsx',
      artifactKind: 'xlsx' as const,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 4,
      sha256: 'b'.repeat(64)
    }
    const artifactStore = { bindMetadata: vi.fn().mockReturnValue(artifact) }

    const prepared = await prepareTeamChatAttachments({
      message: 'summarize',
      attachments: [artifact],
      conversationId: 'conversation',
      requestId: 'request',
      artifactStore: artifactStore as never
    })

    expect(artifactStore.bindMetadata).toHaveBeenCalledWith(
      artifact.artifactId,
      'conversation',
      'request'
    )
    expect(prepared.reusableArtifactIds).toEqual([artifact.artifactId])
    expect(prepared.ephemeralArtifactIds).toEqual([])
  })

  it('drops malformed base64 and unsupported binary extensions', () => {
    expect(
      normalizeTeamChatAttachments([
        { kind: 'document', name: 'bad.xlsx', contentBase64: 'not-base64' },
        { kind: 'document', name: 'archive.zip', contentBase64: 'UEsDBA==' }
      ])
    ).toEqual([])
  })
})
