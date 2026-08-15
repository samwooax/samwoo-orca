// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveClipboardImageAsTempFile: vi.fn(),
  pickHermesTeamChatAttachments: vi.fn(),
  attachHermesTeamChatProjectFile: vi.fn(),
  releaseHermesTeamChatArtifact: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

Object.assign(window, {
  api: {
    ui: { saveClipboardImageAsTempFile: mocks.saveClipboardImageAsTempFile },
    preflight: {
      pickHermesTeamChatAttachments: mocks.pickHermesTeamChatAttachments,
      attachHermesTeamChatProjectFile: mocks.attachHermesTeamChatProjectFile,
      releaseHermesTeamChatArtifact: mocks.releaseHermesTeamChatArtifact
    }
  }
})
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { useHermesTeamChatAttachments } from './use-hermes-team-chat-attachments'

type HookApi = ReturnType<typeof useHermesTeamChatAttachments>

function Probe({ onReady }: { onReady: (api: HookApi) => void }): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  onReady(useHermesTeamChatAttachments(textareaRef, false, 'conversation-one', 'C:\\project'))
  return createElement('textarea', { ref: textareaRef })
}

let root: Root | null = null

async function renderProbe(): Promise<() => HookApi> {
  const container = document.createElement('div')
  document.body.append(container)
  let api: HookApi | null = null
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(Probe, {
        onReady: (next) => {
          api = next
        }
      })
    )
  })
  return () => {
    if (!api) {
      throw new Error('Probe did not render')
    }
    return api
  }
}

function pasteEvent(type: string): React.ClipboardEvent<HTMLTextAreaElement> {
  return {
    clipboardData: { items: [{ type }] },
    preventDefault: vi.fn()
  } as unknown as React.ClipboardEvent<HTMLTextAreaElement>
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('useHermesTeamChatAttachments', () => {
  it('keeps selected Office files as opaque artifact handles', async () => {
    const attachment = {
      kind: 'artifact' as const,
      artifactId: 'artifact-00000000-0000-4000-8000-000000000000',
      name: 'KPI.xlsx',
      artifactKind: 'xlsx' as const,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 4,
      sha256: 'a'.repeat(64)
    }
    mocks.pickHermesTeamChatAttachments.mockResolvedValue({
      cancelled: false,
      attachments: [attachment],
      rejected: []
    })
    const latest = await renderProbe()

    await act(async () => {
      await latest().pickAttachments()
    })

    expect(latest().attachments).toEqual([attachment])
    expect(latest().attachmentNotice).toBeNull()

    act(() => latest().completeAttachmentSend())
    expect(latest().attachments).toEqual([attachment])
    expect(mocks.releaseHermesTeamChatArtifact).not.toHaveBeenCalled()
  })

  it('turns a pasted clipboard screenshot into an image attachment', async () => {
    mocks.saveClipboardImageAsTempFile.mockResolvedValue('/tmp/orca-paste-1-id.png')
    const latest = await renderProbe()
    const event = pasteEvent('image/png')

    await act(async () => {
      latest().pasteClipboardImage(event)
      await Promise.resolve()
    })

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.saveClipboardImageAsTempFile).toHaveBeenCalledOnce()
    expect(latest().attachments).toEqual([
      { kind: 'image', name: 'pasted-image.png', path: '/tmp/orca-paste-1-id.png' }
    ])

    act(() => latest().completeAttachmentSend())
    expect(latest().attachments).toEqual([])
  })

  it('admits an Explorer file as an attachment without adding an @ path', async () => {
    const attachment = {
      kind: 'artifact' as const,
      artifactId: 'artifact-00000000-0000-4000-8000-000000000001',
      name: 'KPI.xlsx',
      artifactKind: 'xlsx' as const,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 4,
      sha256: 'b'.repeat(64)
    }
    mocks.attachHermesTeamChatProjectFile.mockResolvedValue({
      cancelled: false,
      attachments: [attachment],
      rejected: []
    })
    const latest = await renderProbe()

    await act(async () => {
      expect(latest().attachProjectFile('reports/KPI.xlsx')).toBe(true)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.attachHermesTeamChatProjectFile).toHaveBeenCalledWith({
      conversationId: 'conversation-one',
      cwd: 'C:\\project',
      relativePath: 'reports/KPI.xlsx'
    })
    expect(latest().attachments).toEqual([attachment])
  })

  it('leaves ordinary text paste to the textarea', async () => {
    const latest = await renderProbe()
    const event = pasteEvent('text/plain')

    act(() => latest().pasteClipboardImage(event))

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mocks.saveClipboardImageAsTempFile).not.toHaveBeenCalled()
  })
})
