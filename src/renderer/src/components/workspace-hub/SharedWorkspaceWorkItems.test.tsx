// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import SharedWorkspaceWorkItems from './SharedWorkspaceWorkItems'

const api = {
  listWorkItems: vi.fn(),
  createWorkItem: vi.fn(),
  setWorkItemCompleted: vi.fn(),
  setWorkItemAssignee: vi.fn()
}
const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn(async () => undefined) }))

vi.mock('@/lib/samwoo-auth-store', () => ({
  useSamwooAuthStore: (selector: (state: unknown) => unknown) => selector({ logout: logoutMock })
}))

const workItem = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  shareId: 'share-1',
  title: '도면 검토',
  assigneeLogin: null,
  completed: false,
  completedBy: null,
  completedAt: null,
  createdBy: 'owner',
  createdAt: 1,
  updatedBy: 'owner',
  updatedAt: 1
}

describe('SharedWorkspaceWorkItems', () => {
  beforeEach(() => {
    Object.values(api).forEach((mockFn) => mockFn.mockReset())
    api.listWorkItems.mockResolvedValue({ ok: true, workItems: [workItem] })
    api.createWorkItem.mockResolvedValue({
      ok: true,
      workItem: { ...workItem, id: '123e4567-e89b-42d3-a456-426614174001', title: 'BOM 검토' }
    })
    api.setWorkItemCompleted.mockResolvedValue({
      ok: true,
      workItem: { ...workItem, completed: true, completedBy: 'owner', completedAt: 2 }
    })
    api.setWorkItemAssignee.mockResolvedValue({
      ok: true,
      workItem: { ...workItem, assigneeLogin: 'peer' }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { preflight: { samwooWorkspaceShares: api } }
    })
  })

  afterEach(cleanup)

  it('loads, creates, completes, and assigns a work item', async () => {
    const onSummaryRefresh = vi.fn(async () => undefined)
    render(
      <TooltipProvider>
        <SharedWorkspaceWorkItems
          shareId="share-1"
          token="test-session-token-1234567890"
          canEdit
          members={[
            { login: 'owner', name: 'Owner' },
            { login: 'peer', name: 'Peer' }
          ]}
          onSummaryRefresh={onSummaryRefresh}
        />
      </TooltipProvider>
    )

    expect(await screen.findByText('도면 검토')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '도면 검토' }))
    await waitFor(() => expect(api.setWorkItemCompleted).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
    fireEvent.click(await screen.findByText('peer'))
    await waitFor(() =>
      expect(api.setWorkItemAssignee).toHaveBeenCalledWith({
        token: 'test-session-token-1234567890',
        shareId: 'share-1',
        workItemId: workItem.id,
        assigneeLogin: 'peer'
      })
    )

    fireEvent.change(screen.getByPlaceholderText('Add work item…'), {
      target: { value: 'BOM 검토' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add work item…' }))
    expect(await screen.findByText('BOM 검토')).toBeTruthy()
    expect(onSummaryRefresh).toHaveBeenCalledTimes(3)
  })

  it('keeps download-only work items read-only', async () => {
    render(
      <TooltipProvider>
        <SharedWorkspaceWorkItems
          shareId="share-1"
          token="test-session-token-1234567890"
          canEdit={false}
          members={[]}
          onSummaryRefresh={vi.fn(async () => undefined)}
        />
      </TooltipProvider>
    )

    expect(await screen.findByText('도면 검토')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: '도면 검토' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByPlaceholderText('Add work item…')).toBeNull()
  })

  it('ignores a mutation response after switching workspaces', async () => {
    let resolveCompletion: (value: unknown) => void = () => undefined
    api.setWorkItemCompleted.mockReturnValue(
      new Promise((resolve) => {
        resolveCompletion = resolve
      })
    )
    api.listWorkItems.mockImplementation(({ shareId }: { shareId: string }) =>
      Promise.resolve({
        ok: true,
        workItems: [
          shareId === 'share-1'
            ? workItem
            : { ...workItem, id: '123e4567-e89b-42d3-a456-426614174002', shareId, title: '새 작업' }
        ]
      })
    )
    const props = {
      token: 'test-session-token-1234567890',
      canEdit: true,
      members: [] as const,
      onSummaryRefresh: vi.fn(async () => undefined)
    }
    const { rerender } = render(
      <TooltipProvider>
        <SharedWorkspaceWorkItems shareId="share-1" {...props} />
      </TooltipProvider>
    )
    fireEvent.click(await screen.findByRole('checkbox', { name: '도면 검토' }))

    rerender(
      <TooltipProvider>
        <SharedWorkspaceWorkItems shareId="share-2" {...props} />
      </TooltipProvider>
    )
    expect(await screen.findByText('새 작업')).toBeTruthy()
    resolveCompletion({ ok: true, workItem: { ...workItem, completed: true } })
    await waitFor(() => expect(screen.queryByText('도면 검토')).toBeNull())
    expect(screen.getByText('새 작업')).toBeTruthy()
  })
})
