const STORAGE_PREFIX = 'samwoo-workspace-seen-revision'

function storageKey(login: string, shareId: string): string {
  return `${STORAGE_PREFIX}:${login}:${shareId}`
}

export function readSharedWorkspaceSeenRevision(login: string, shareId: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(storageKey(login, shareId)))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function writeSharedWorkspaceSeenRevision(
  login: string,
  shareId: string,
  revision: number
): void {
  try {
    window.localStorage.setItem(storageKey(login, shareId), String(revision))
  } catch {
    // Why: notification history is optional and must not block workspace synchronization.
  }
}
