// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { NativeChatComposerHandle } from './native-chat-composer-types'
import { requestNativeChatFileReference } from './native-chat-file-reference'
import { useNativeChatFileReference } from './use-native-chat-file-reference'

let root: Root | null = null

function Probe({
  terminalTabId,
  insertFileReference
}: {
  terminalTabId: string
  insertFileReference: (relativePath: string) => boolean
}): null {
  const composerRef = useRef({
    insertFileReference
  } as NativeChatComposerHandle)
  useNativeChatFileReference(terminalTabId, composerRef)
  return null
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('useNativeChatFileReference', () => {
  it('routes a file only to the requested active chat tab', async () => {
    const insertFileReference = vi.fn().mockReturnValue(true)
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(createElement(Probe, { terminalTabId: 'tab-1', insertFileReference }))
    })

    expect(requestNativeChatFileReference('tab-2', 'src/other.ts')).toBe(false)
    expect(requestNativeChatFileReference('tab-1', 'src/server.ts')).toBe(true)
    expect(insertFileReference).toHaveBeenCalledOnce()
    expect(insertFileReference).toHaveBeenCalledWith('src/server.ts')
  })
})
