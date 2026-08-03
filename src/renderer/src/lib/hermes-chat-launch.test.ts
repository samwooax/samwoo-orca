import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connectionId: null as string | null,
  runtimeEnvironmentId: null as string | null,
  ensureChatServer: vi.fn(),
  createBrowserTab: vi.fn(),
  createTab: vi.fn(() => ({ id: 'terminal-1' })),
  setActiveTab: vi.fn(),
  queueTabStartupCommand: vi.fn()
}))

const appState = {
  settings: {
    hermesUseWebChat: true,
    hermesDashboardHost: 'hermes@100.68.242.83',
    theme: 'dark'
  },
  folderWorkspaces: [{ id: 'folder-1', folderPath: 'C:\\Work\\HR' }],
  createBrowserTab: mocks.createBrowserTab,
  createTab: mocks.createTab,
  setActiveTab: mocks.setActiveTab,
  queueTabStartupCommand: mocks.queueTabStartupCommand
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => appState }
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionId: () => mocks.connectionId
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: () => mocks.runtimeEnvironmentId
}))

vi.mock('@/runtime/web-runtime-session', () => ({
  isWebRuntimeSessionActive: (runtimeEnvironmentId: string | null) => Boolean(runtimeEnvironmentId)
}))

vi.mock('@/lib/samwoo-auth-store', () => ({
  getSamwooAuth: () => ({ token: 'mail-token' })
}))

vi.mock('@/lib/start-agent-picker-store', () => ({
  DEFAULT_HERMES_DASHBOARD_HOST: 'hermes@default',
  DEFAULT_HERMES_LAUNCH_COMMAND: 'hermes --profile {profile}',
  hermesProfileLabel: (profile: string) => (profile === 'ai_center' ? 'AI 센터' : profile)
}))

describe('Hermes chat launch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.connectionId = null
    mocks.runtimeEnvironmentId = null
    mocks.ensureChatServer.mockResolvedValue({ ok: true, port: 4862, token: 'relay-token' })
    vi.stubGlobal('window', {
      api: { preflight: { ensureHermesChatServer: mocks.ensureChatServer } }
    })
  })

  it('opens a new chat tab with the assigned profile and current folder', async () => {
    const { launchHermesProfileChat } = await import('./hermes-chat-launch')

    await launchHermesProfileChat('folder-1', 'ai_center')

    expect(mocks.createBrowserTab).toHaveBeenCalledTimes(1)
    const [, rawUrl, options] = mocks.createBrowserTab.mock.calls[0]
    const url = new URL(String(rawUrl))
    expect(url.searchParams.get('profile')).toBe('ai_center')
    expect(url.searchParams.get('cwd')).toBe('C:\\Work\\HR')
    expect(url.searchParams.get('mailtoken')).toBe('mail-token')
    expect(options).toEqual({ title: 'AI 센터' })
  })

  it('does not launch a local Hermes chat from an SSH workspace', async () => {
    mocks.connectionId = 'employee-laptop'
    const { launchHermesProfileChat } = await import('./hermes-chat-launch')

    await launchHermesProfileChat('folder-1', 'ai_center')

    expect(mocks.ensureChatServer).not.toHaveBeenCalled()
    expect(mocks.createBrowserTab).not.toHaveBeenCalled()
    expect(mocks.createTab).not.toHaveBeenCalled()
  })

  it('does not launch a local Hermes chat from a web-runtime workspace', async () => {
    mocks.runtimeEnvironmentId = 'paired-runtime'
    const { launchHermesProfileChat } = await import('./hermes-chat-launch')

    await launchHermesProfileChat('folder-1', 'ai_center')

    expect(mocks.ensureChatServer).not.toHaveBeenCalled()
    expect(mocks.createBrowserTab).not.toHaveBeenCalled()
    expect(mocks.createTab).not.toHaveBeenCalled()
  })
})
