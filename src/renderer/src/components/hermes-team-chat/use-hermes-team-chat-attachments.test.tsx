// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ saveClipboardImageAsTempFile: vi.fn() }))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

Object.assign(window, {
  api: { ui: { saveClipboardImageAsTempFile: mocks.saveClipboardImageAsTempFile } }
})
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { useHermesTeamChatAttachments } from './use-hermes-team-chat-attachments'

type HookApi = ReturnType<typeof useHermesTeamChatAttachments>

function Probe({ onReady }: { onReady: (api: HookApi) => void }): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  onReady(useHermesTeamChatAttachments(textareaRef, false))
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
  })

  it('leaves ordinary text paste to the textarea', async () => {
    const latest = await renderProbe()
    const event = pasteEvent('text/plain')

    act(() => latest().pasteClipboardImage(event))

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mocks.saveClipboardImageAsTempFile).not.toHaveBeenCalled()
  })
})
