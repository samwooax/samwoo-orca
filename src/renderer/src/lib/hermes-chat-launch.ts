import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { getSamwooAuth } from '@/lib/samwoo-auth-store'
import {
  DEFAULT_HERMES_DASHBOARD_HOST,
  DEFAULT_HERMES_LAUNCH_COMMAND,
  hermesProfileLabel
} from '@/lib/start-agent-picker-store'

function resolveWorkspaceCwd(workspaceKey: string): string {
  const separatorIndex = workspaceKey.indexOf('::')
  if (separatorIndex >= 0) {
    return workspaceKey.slice(separatorIndex + 2)
  }
  const folderWorkspace = useAppStore
    .getState()
    .folderWorkspaces?.find((workspace) => workspace.id === workspaceKey)
  return folderWorkspace?.folderPath ?? ''
}

export function canLaunchHermesChat(workspaceKey: string): boolean {
  const state = useAppStore.getState()
  return (
    !getConnectionId(workspaceKey) &&
    !isWebRuntimeSessionActive(getRuntimeEnvironmentIdForWorktree(state, workspaceKey))
  )
}

export async function launchHermesProfileChat(
  workspaceKey: string,
  profile: string
): Promise<void> {
  if (!canLaunchHermesChat(workspaceKey)) {
    return
  }

  const state = useAppStore.getState()
  const useWeb = state.settings?.hermesUseWebChat !== false
  if (useWeb) {
    const host = state.settings?.hermesDashboardHost?.trim() || DEFAULT_HERMES_DASHBOARD_HOST
    try {
      const result = await window.api.preflight.ensureHermesChatServer()
      if (result.ok && result.port && result.token) {
        const appTheme = state.settings?.theme
        const cwd = resolveWorkspaceCwd(workspaceKey)
        const mailToken = getSamwooAuth()?.token
        const params = new URLSearchParams({
          profile,
          label: hermesProfileLabel(profile),
          host,
          t: result.token,
          ...(cwd ? { cwd } : {}),
          ...(mailToken ? { mailtoken: mailToken } : {}),
          ...(appTheme === 'light' || appTheme === 'dark' ? { theme: appTheme } : {})
        })
        const url = `http://127.0.0.1:${result.port}/chat?${params.toString()}`
        useAppStore
          .getState()
          .createBrowserTab(workspaceKey, url, { title: hermesProfileLabel(profile) })
        return
      }
    } catch {
      // Why: the terminal client remains usable when the local chat relay cannot start.
    }
  }

  const template = state.settings?.hermesLaunchCommand?.trim() || DEFAULT_HERMES_LAUNCH_COMMAND
  const startupState = useAppStore.getState()
  const tab = startupState.createTab(workspaceKey, undefined, undefined, {
    pendingActivationSpawn: true,
    recordInteraction: false
  })
  startupState.setActiveTab(tab.id)
  startupState.queueTabStartupCommand(tab.id, {
    command: template.replaceAll('{profile}', profile)
  })
}
