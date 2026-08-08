// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStatusDefinition } from '../../../../shared/types'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import WorkspaceHubViews from './WorkspaceHubViews'

const statuses: WorkspaceStatusDefinition[] = [
  { id: 'todo', label: 'To do', color: 'neutral' },
  { id: 'in-progress', label: 'In progress', color: 'blue' }
]
const share: SamwooWorkspaceShare = {
  id: 'share-1',
  ownerLogin: 'kim',
  ownerProfile: 'ai_center',
  displayName: 'Design review',
  permission: 'contribute',
  createdAt: 1,
  updatedAt: 2,
  boardStatus: 'in-progress',
  isOwner: true,
  commentCount: 3
}
const roots: Root[] = []

async function renderView(mode: 'list' | 'board', onSelect = vi.fn()): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <WorkspaceHubViews
        mode={mode}
        shares={[share]}
        login="kim"
        statuses={statuses}
        selectedShareId={null}
        onSelect={onSelect}
        onEditName={vi.fn()}
        onRevoke={vi.fn()}
      />
    )
  })
  return container
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  document.body.innerHTML = ''
  localStorage.clear()
})

describe('WorkspaceHubViews', () => {
  it('renders the stage-one list columns and opens details from a row', async () => {
    const onSelect = vi.fn()
    const container = await renderView('list', onSelect)

    expect(container.textContent).toContain('Name')
    expect(container.textContent).toContain('Status')
    expect(container.textContent).toContain('Permission')
    expect(container.textContent).toContain('Last updated')
    expect(container.textContent).not.toContain('Assignee')
    expect(container.textContent).not.toContain('Due date')

    await act(async () => {
      container.querySelector<HTMLElement>('[role="button"]')?.click()
    })
    expect(onSelect).toHaveBeenCalledWith('share-1')
  })

  it('groups cards by workspace status without drag controls', async () => {
    const container = await renderView('board')

    expect(container.textContent).toContain('To do')
    expect(container.textContent).toContain('In progress')
    expect(container.textContent).toContain('Design review')
    expect(container.textContent).toContain('3')
    expect(container.querySelector('[draggable="true"]')).toBeNull()
  })
})
