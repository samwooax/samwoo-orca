// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStatusDefinition } from '../../../../shared/types'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import { TooltipProvider } from '@/components/ui/tooltip'
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
  dueDate: '2000-01-01',
  isOwner: true,
  commentCount: 3,
  workItemCount: 5,
  completedWorkItemCount: 2
}
const roots: Root[] = []

async function renderView(
  mode: 'list' | 'board',
  onSelect = vi.fn(),
  shares: SamwooWorkspaceShare[] = [share]
): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <WorkspaceHubViews
          mode={mode}
          shares={shares}
          login="kim"
          statuses={statuses}
          selectedShareId={null}
          onSelect={onSelect}
          onEditName={vi.fn()}
          onRevoke={vi.fn()}
          updatingShareId={null}
          onMoveStatus={vi.fn()}
          members={[
            { login: 'kim', name: '김동훈' },
            { login: 'peer', name: '동료' }
          ]}
          updatingAssigneeShareId={null}
          onUpdateAssignees={vi.fn()}
        />
      </TooltipProvider>
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
    expect(container.textContent).toContain('Assignees')
    expect(container.textContent).toContain('Due date')
    expect(container.querySelector('.text-destructive')).not.toBeNull()
    expect(container.textContent).toContain('2/5 work items complete')

    await act(async () => {
      container.querySelector<HTMLElement>('[role="button"]')?.click()
    })
    expect(onSelect).toHaveBeenCalledWith('share-1')
  })

  it('uses the full workspace card as the drag activator for contributors', async () => {
    const onSelect = vi.fn()
    const container = await renderView('board', onSelect)

    expect(container.textContent).toContain('To do')
    expect(container.textContent).toContain('In progress')
    expect(container.textContent).toContain('Design review')
    expect(container.textContent).toContain('3')
    expect(container.textContent).toContain('2/5')
    const card = container.querySelector('[data-workspace-draggable="true"]')
    expect(card).not.toBeNull()
    expect(card?.querySelectorAll('button')).toHaveLength(1)
    expect(card?.querySelector('button')?.classList.contains('cursor-grab')).toBe(true)
    expect(card?.querySelector('[aria-label="Board status"]')).toBeNull()
    await act(async () => card?.querySelector<HTMLButtonElement>('button')?.click())
    expect(onSelect).toHaveBeenCalledWith('share-1')
  })

  it('does not expose a drag handle to download-only members', async () => {
    const container = await renderView('board', vi.fn(), [
      { ...share, isOwner: false, permission: 'download' }
    ])

    expect(container.querySelector('[data-workspace-draggable="true"]')).toBeNull()
    expect(container.querySelector('[data-workspace-draggable="false"]')).not.toBeNull()
  })
})
