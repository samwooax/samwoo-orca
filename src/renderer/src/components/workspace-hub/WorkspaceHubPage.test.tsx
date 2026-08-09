// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearAssignments: vi.fn(),
  catalog: {
    login: 'dhoon21',
    profile: 'ai_center',
    shares: [],
    shareableRepos: [],
    repoId: '',
    displayName: '',
    permission: 'download' as const,
    refreshing: false,
    createStage: null,
    setRepoId: vi.fn(),
    setDisplayName: vi.fn(),
    setPermission: vi.fn(),
    refresh: vi.fn(async () => undefined),
    create: vi.fn(async () => false),
    revoke: vi.fn(async () => false)
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { workspaceStatuses: never[] }) => unknown) =>
    selector({ workspaceStatuses: [] })
}))

vi.mock('@/lib/samwoo-workspace-assignment-inbox-store', () => ({
  useSamwooWorkspaceAssignmentInboxStore: (selector: (state: { clear: () => void }) => unknown) =>
    selector({ clear: mocks.clearAssignments })
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('./use-workspace-hub-catalog', () => ({
  useWorkspaceHubCatalog: () => mocks.catalog
}))

vi.mock('./use-workspace-hub-assignees', () => ({
  useWorkspaceHubAssignees: () => ({
    members: [],
    updatingShareId: null,
    updateAssignees: vi.fn()
  })
}))

vi.mock('./use-workspace-hub-board-status-update', () => ({
  useWorkspaceHubBoardStatusUpdate: () => ({ updatingShareId: null, updateBoardStatus: vi.fn() })
}))

vi.mock('./use-workspace-hub-due-date', () => ({
  useWorkspaceHubDueDate: () => ({ updatingShareId: null, updateDueDate: vi.fn() })
}))

vi.mock('./use-workspace-hub-wide-layout', () => ({
  useWorkspaceHubWideLayout: () => true
}))

vi.mock('./WorkspaceHubViews', () => ({ default: () => <div data-testid="workspace-views" /> }))
vi.mock('./WorkspaceHubCreateForm', () => ({ default: () => <div /> }))
vi.mock('./SharedWorkspaceDetails', () => ({ default: () => <div /> }))

import WorkspaceHubPage from './WorkspaceHubPage'

const roots: Root[] = []

async function renderPage(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<WorkspaceHubPage />))
  return container
}

describe('WorkspaceHubPage toolbar', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()))
    document.body.replaceChildren()
  })

  it('omits the summary copy and uses the compact toolbar button sizes', async () => {
    const container = await renderPage()
    const header = container.querySelector('header')
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('header button'))

    expect(header?.textContent).not.toContain('Workspaces')
    expect(header?.textContent).not.toContain('ai_center')
    expect(header?.textContent).not.toContain('shared')
    expect(buttons.map((button) => button.dataset.size)).toEqual(['xs', 'xs', 'icon-xs', 'xs'])
  })
})
