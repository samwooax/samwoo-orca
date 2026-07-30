import { create } from 'zustand'

/** SAMWOO-ORCA: state for the project-open agent picker (Claude / Hermes
 *  profiles / plain terminal). Kept in a standalone store so worktree
 *  activation can request it without widening the app store's state shape. */
type StartAgentPickerState = {
  workspaceKey: string | null
  /** Last successful profile listing — shown instantly on the next open while a background refresh runs. */
  cachedProfiles: string[] | null
  request: (workspaceKey: string) => void
  close: () => void
  setCachedProfiles: (profiles: string[]) => void
}

export const useStartAgentPickerStore = create<StartAgentPickerState>((set) => ({
  workspaceKey: null,
  cachedProfiles: null,
  request: (workspaceKey) => set({ workspaceKey }),
  close: () => set({ workspaceKey: null }),
  setCachedProfiles: (profiles) => set({ cachedProfiles: profiles })
}))

export function requestStartAgentPicker(workspaceKey: string): void {
  useStartAgentPickerStore.getState().request(workspaceKey)
}

// SAMWOO-ORCA defaults target the team-bot Hermes container over Tailscale
// SSH. `sh -lc` matters: a non-login shell misses the container env and lists
// only the default profile. accept-new avoids the interactive first-connect
// host-key prompt, which would hang the non-interactive list command.
// ControlMaster keeps one warm connection so the launch after the picker's
// list call skips the ~1s SSH handshake; Windows OpenSSH lacks mux support,
// so those options are POSIX-only.
const IS_WINDOWS_CLIENT =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
const SSH_MUX_OPTS = IS_WINDOWS_CLIENT
  ? ''
  : ' -o ControlMaster=auto -o ControlPath=/tmp/.samwoo-orca-ssh-%r@%h-%p -o ControlPersist=10m'
export const DEFAULT_HERMES_DASHBOARD_HOST = 'hermes@100.68.242.83'
export const DEFAULT_HERMES_DASHBOARD_REMOTE_PORT = 4862
export const DEFAULT_HERMES_PROFILE_LIST_COMMAND = `ssh -o StrictHostKeyChecking=accept-new${SSH_MUX_OPTS} hermes@100.68.242.83 "sh -lc 'hermes profile list'"`
export const DEFAULT_HERMES_LAUNCH_COMMAND = `ssh -tt -o StrictHostKeyChecking=accept-new${SSH_MUX_OPTS} hermes@100.68.242.83 "sh -lc 'hermes --tui --profile {profile}'"`

const PROFILE_NAME_RE = /^[A-Za-z0-9._-]+$/

/** SAMWOO-ORCA: Korean display names matching the Slack bot names (minus the
 *  "봇" suffix). Unmapped profiles fall back to their raw name. */
export const HERMES_PROFILE_LABELS: Record<string, string> = {
  ai_center: 'AI 센터',
  hr: '총무인사',
  cs: '영업1팀 CS',
  finance: '재경',
  oliver: '전략기획',
  planning: '영업기획',
  sales: '영업',
  default: '기본'
}

export function hermesProfileLabel(profile: string): string {
  return HERMES_PROFILE_LABELS[profile] ?? profile
}

/** Parse `hermes profile list` table output into profile names. The table has
 *  a header row, a box-drawing separator row, and one row per profile whose
 *  first column may carry a `◆` marker on the sticky default profile. */
export function parseHermesProfileList(stdout: string): string[] {
  const names: string[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    const firstToken = line.split(/\s+/, 1)[0] ?? ''
    const name = firstToken.replace(/^[◆*>]+/, '')
    if (!name || name.toLowerCase() === 'profile') {
      continue
    }
    if (/^[─━┈┄-]+$/.test(name)) {
      continue
    }
    if (!PROFILE_NAME_RE.test(name)) {
      continue
    }
    if (!names.includes(name)) {
      names.push(name)
    }
  }
  return names
}
