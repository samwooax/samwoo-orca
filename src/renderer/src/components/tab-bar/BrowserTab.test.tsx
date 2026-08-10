import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserTab as BrowserTabState } from '../../../../shared/types'

const reactHookRuntime = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    useEffect: () => {},
    // Why: this shallow harness calls the component as a plain function (no React
    // render), so ref/callback hooks must be stubbed like useState/useEffect. The
    // favicon tests never fire pointer events, so non-persistent refs are fine.
    useRef: <T,>(initial: T) => ({ current: initial }),
    useCallback: <T,>(fn: T) => fn,
    useState<T>(initial: T | (() => T)) {
      const stateIndex = reactHookRuntime.index++
      if (!(stateIndex in reactHookRuntime.states)) {
        reactHookRuntime.states[stateIndex] =
          typeof initial === 'function' ? (initial as () => T)() : initial
      }
      const setState = (next: T | ((previous: T) => T)): void => {
        reactHookRuntime.states[stateIndex] =
          typeof next === 'function'
            ? (next as (previous: T) => T)(reactHookRuntime.states[stateIndex] as T)
            : next
      }
      return [reactHookRuntime.states[stateIndex] as T, setState] as const
    }
  }
})

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: { onPointerDown: vi.fn() },
    setNodeRef: vi.fn()
  })
}))

vi.mock('lucide-react', () => ({
  ArrowDown: function ArrowDown(props: Record<string, unknown>) {
    return { type: 'ArrowDown', props }
  },
  ArrowLeft: function ArrowLeft(props: Record<string, unknown>) {
    return { type: 'ArrowLeft', props }
  },
  ArrowRight: function ArrowRight(props: Record<string, unknown>) {
    return { type: 'ArrowRight', props }
  },
  ArrowUp: function ArrowUp(props: Record<string, unknown>) {
    return { type: 'ArrowUp', props }
  },
  Columns2: function Columns2(props: Record<string, unknown>) {
    return { type: 'Columns2', props }
  },
  Copy: function Copy(props: Record<string, unknown>) {
    return { type: 'Copy', props }
  },
  CopyX: function CopyX(props: Record<string, unknown>) {
    return { type: 'CopyX', props }
  },
  ExternalLink: function ExternalLink(props: Record<string, unknown>) {
    return { type: 'ExternalLink', props }
  },
  Globe: function Globe(props: Record<string, unknown>) {
    return { type: 'Globe', props }
  },
  Pin: function Pin(props: Record<string, unknown>) {
    return { type: 'Pin', props }
  },
  PinOff: function PinOff(props: Record<string, unknown>) {
    return { type: 'PinOff', props }
  },
  PanelLeftClose: function PanelLeftClose(props: Record<string, unknown>) {
    return { type: 'PanelLeftClose', props }
  },
  PanelRightClose: function PanelRightClose(props: Record<string, unknown>) {
    return { type: 'PanelRightClose', props }
  },
  Rows2: function Rows2(props: Record<string, unknown>) {
    return { type: 'Rows2', props }
  },
  X: function X(props: Record<string, unknown>) {
    return { type: 'X', props }
  }
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: function DropdownMenu(props: { children?: unknown }) {
    return { type: 'DropdownMenu', props }
  },
  DropdownMenuContent: function DropdownMenuContent(props: { children?: unknown }) {
    return { type: 'DropdownMenuContent', props }
  },
  DropdownMenuItem: function DropdownMenuItem(props: { children?: unknown }) {
    return { type: 'DropdownMenuItem', props }
  },
  DropdownMenuSeparator: function DropdownMenuSeparator() {
    return { type: 'DropdownMenuSeparator', props: {} }
  },
  DropdownMenuShortcut: function DropdownMenuShortcut(props: { children?: unknown }) {
    return { type: 'DropdownMenuShortcut', props }
  },
  DropdownMenuLabel: function DropdownMenuLabel(props: { children?: unknown }) {
    return { type: 'DropdownMenuLabel', props }
  },
  DropdownMenuSub: function DropdownMenuSub(props: { children?: unknown }) {
    return { type: 'DropdownMenuSub', props }
  },
  DropdownMenuSubContent: function DropdownMenuSubContent(props: { children?: unknown }) {
    return { type: 'DropdownMenuSubContent', props }
  },
  DropdownMenuSubTrigger: function DropdownMenuSubTrigger(props: { children?: unknown }) {
    return { type: 'DropdownMenuSubTrigger', props }
  },
  DropdownMenuTrigger: function DropdownMenuTrigger(props: { children?: unknown }) {
    return { type: 'DropdownMenuTrigger', props }
  }
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: function Tooltip(props: { children?: unknown }) {
    return { type: 'Tooltip', props }
  },
  TooltipContent: function TooltipContent(props: { children?: unknown }) {
    return { type: 'TooltipContent', props }
  },
  TooltipTrigger: function TooltipTrigger(props: { children?: unknown }) {
    return props.children
  }
}))

vi.mock('../browser-pane/browser-runtime', () => ({
  getLiveBrowserUrl: () => null
}))

type ReactElementLike = {
  type: unknown
  props: Record<string, unknown>
}

function baseBrowserTab(overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id: 'browser-1',
    worktreeId: 'wt-1',
    label: 'Browser 1',
    sessionProfileId: null,
    activePageId: 'page-1',
    pageIds: ['page-1'],
    url: 'https://example.com/',
    title: 'Example',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 0,
    ...overrides
  }
}

async function renderBrowserTab(
  tab: BrowserTabState,
  labelOverride?: string,
  showLoadingIndicator?: boolean
): Promise<unknown> {
  reactHookRuntime.index = 0
  const module = await import('./BrowserTab')
  return module.default({
    tab,
    isActive: true,
    isPinned: false,
    hasTabsToRight: false,
    hasTabsToLeft: false,
    tabCount: 1,
    onActivate: () => {},
    onClose: () => {},
    onCloseOthers: () => {},
    onCloseToRight: () => {},
    onCloseToLeft: () => {},
    onDuplicate: () => {},
    onTogglePin: () => {},
    labelOverride,
    showLoadingIndicator,
    dragData: {
      kind: 'tab',
      worktreeId: tab.worktreeId,
      groupId: 'group-1',
      unifiedTabId: tab.id,
      visibleTabId: tab.id,
      tabType: 'browser',
      label: tab.title
    },
    dropIndicator: undefined
  })
}

function expandNode(node: unknown): unknown {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return node
  }
  if (Array.isArray(node)) {
    return node.map(expandNode)
  }
  const el = node as ReactElementLike
  if (typeof el.type === 'function') {
    return expandNode(el.type(el.props))
  }
  return {
    ...el,
    props: {
      ...el.props,
      children: expandNode(el.props?.children)
    }
  }
}

function findElementsByType(node: unknown, typeName: string): ReactElementLike[] {
  const results: ReactElementLike[] = []
  const visit = (current: unknown): void => {
    if (current == null || typeof current === 'string' || typeof current === 'number') {
      return
    }
    if (Array.isArray(current)) {
      for (const child of current) {
        visit(child)
      }
      return
    }
    const el = current as ReactElementLike
    if (el.type === typeName) {
      results.push(el)
    }
    visit(el.props?.children)
  }
  visit(node)
  return results
}

async function renderExpandedBrowserTab(
  tab: BrowserTabState,
  labelOverride?: string,
  showLoadingIndicator?: boolean
): Promise<unknown> {
  return expandNode(await renderBrowserTab(tab, labelOverride, showLoadingIndicator))
}

function browserTabRootChildren(node: unknown): ReactElementLike[] {
  const tabRoot = findElementsByType(node, 'div').find(
    (candidate) => candidate.props['data-tab-id'] === 'browser-1'
  )
  if (!tabRoot || !Array.isArray(tabRoot.props.children)) {
    throw new Error('browser tab root was not rendered')
  }
  return tabRoot.props.children.filter((child): child is ReactElementLike =>
    Boolean(child && typeof child === 'object')
  )
}

describe('BrowserTab favicon', { timeout: 30_000 }, () => {
  beforeEach(() => {
    reactHookRuntime.states = []
    reactHookRuntime.index = 0
    vi.clearAllMocks()
  })

  it('renders the favicon image when faviconUrl is present', async () => {
    const iconUrl = 'https://example.com/favicon.ico'
    const element = await renderExpandedBrowserTab(baseBrowserTab({ faviconUrl: iconUrl }))

    const images = findElementsByType(element, 'img')
    expect(images).toHaveLength(1)
    expect(images[0].props.src).toBe(iconUrl)
    expect(images[0].props.alt).toBe('')
    expect(images[0].props['aria-hidden']).toBe(true)
    expect(images[0].props.draggable).toBe(false)
    expect(images[0].props.className).toContain('size-3 mr-1 shrink-0')
    expect(images[0].props.className).toContain('object-contain')
    expect(images[0].props.className).toContain('drop-shadow-[0_0_1px_var(--foreground)]')
    expect(findElementsByType(element, 'Globe')).toHaveLength(0)
  })

  it('uses an app label override instead of a stale browser title', async () => {
    const element = await renderExpandedBrowserTab(
      baseBrowserTab({ title: 'd_support' }),
      '대구영업지원'
    )
    const children = browserTabRootChildren(element)

    expect(
      children.some((child) => child.type === 'span' && child.props.children === '대구영업지원')
    ).toBe(true)
    expect(
      children.some((child) => child.type === 'span' && child.props.children === 'd_support')
    ).toBe(false)
  })

  it('renders no icon for blank tabs without faviconUrl', async () => {
    const element = await renderExpandedBrowserTab(
      baseBrowserTab({
        url: 'about:blank',
        title: 'about:blank',
        faviconUrl: null
      })
    )

    expect(findElementsByType(element, 'img')).toHaveLength(0)
    expect(findElementsByType(element, 'Globe')).toHaveLength(0)
  })

  it('renders no icon after the favicon image errors', async () => {
    const tab = baseBrowserTab({ faviconUrl: 'https://example.com/favicon.ico' })
    const firstRender = await renderExpandedBrowserTab(tab)
    const image = findElementsByType(firstRender, 'img')[0]

    ;(image.props.onError as () => void)()
    const secondRender = await renderExpandedBrowserTab(tab)

    expect(findElementsByType(secondRender, 'img')).toHaveLength(0)
    expect(findElementsByType(secondRender, 'Globe')).toHaveLength(0)
  })

  it('resets the image-error fallback when faviconUrl changes', async () => {
    const tab = baseBrowserTab({ faviconUrl: 'https://example.com/favicon.ico' })
    const firstRender = await renderExpandedBrowserTab(tab)
    const image = findElementsByType(firstRender, 'img')[0]

    ;(image.props.onError as () => void)()
    const failedRender = await renderExpandedBrowserTab(tab)
    expect(findElementsByType(failedRender, 'img')).toHaveLength(0)
    expect(findElementsByType(failedRender, 'Globe')).toHaveLength(0)

    const nextIconUrl = 'data:image/png;base64,abc123'
    const resetRender = await renderExpandedBrowserTab(
      baseBrowserTab({ id: tab.id, faviconUrl: nextIconUrl })
    )

    const images = findElementsByType(resetRender, 'img')
    expect(images).toHaveLength(1)
    expect(images[0].props.src).toBe(nextIconUrl)
    expect(findElementsByType(resetRender, 'Globe')).toHaveLength(0)
  })

  it('places the loading dot before the favicon and label', async () => {
    const element = await renderExpandedBrowserTab(
      baseBrowserTab({ loading: true, faviconUrl: 'https://example.com/favicon.ico' })
    )
    const children = browserTabRootChildren(element)
    const loadingIndex = children.findIndex((child) =>
      String(child.props.className ?? '').includes('bg-sky-500/80')
    )
    const faviconIndex = children.findIndex((child) => child.type === 'img')
    const labelIndex = children.findIndex(
      (child) => child.type === 'span' && child.props.children === 'Example'
    )

    expect(loadingIndex).toBeGreaterThanOrEqual(0)
    expect(loadingIndex).toBeLessThan(faviconIndex)
    expect(faviconIndex).toBeLessThan(labelIndex)
  })

  it('places the loading dot before the label when no favicon exists', async () => {
    const element = await renderExpandedBrowserTab(baseBrowserTab({ loading: true }))
    const children = browserTabRootChildren(element)
    const loadingIndex = children.findIndex((child) =>
      String(child.props.className ?? '').includes('bg-sky-500/80')
    )
    const labelIndex = children.findIndex(
      (child) => child.type === 'span' && child.props.children === 'Example'
    )

    expect(findElementsByType(element, 'img')).toHaveLength(0)
    expect(loadingIndex).toBeGreaterThanOrEqual(0)
    expect(loadingIndex).toBeLessThan(labelIndex)
  })

  it('hides the browser loading dot when the host surface supplies its own status', async () => {
    const element = await renderExpandedBrowserTab(
      baseBrowserTab({ loading: true }),
      undefined,
      false
    )
    const children = browserTabRootChildren(element)

    expect(
      children.some((child) => String(child.props.className ?? '').includes('bg-sky-500/80'))
    ).toBe(false)
  })
})
