// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarToolbar from './SidebarToolbar'

vi.mock('./SidebarSettingsHelpMenu', () => ({
  SidebarSettingsHelpMenu: () => <button type="button">Settings</button>
}))

vi.mock('../orca-profiles/OrcaProfileSwitcher', () => ({
  OrcaProfileSwitcher: ({ placement }: { placement?: string }) => (
    <button type="button" data-placement={placement}>
      Profile
    </button>
  )
}))

const roots: Root[] = []

async function renderToolbar(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SidebarToolbar />)
  })
  return container
}

describe('SidebarToolbar', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('renders only the profile and settings controls in that order', async () => {
    const container = await renderToolbar()
    const html = container.innerHTML

    expect(html).toContain('data-placement="sidebar"')
    expect(html.indexOf('Profile')).toBeLessThan(html.indexOf('Settings'))
    expect(html).not.toContain('Workspace board')
    expect(html).not.toContain('Current workspace')
  })
})
