const STORAGE_PREFIX = 'samwoo-workspace-local-path'

function storageKey(login: string, shareId: string): string {
  return `${STORAGE_PREFIX}:${login}:${shareId}`
}

export function readSharedWorkspaceLocalPath(login: string, shareId: string): string {
  try {
    return window.localStorage.getItem(storageKey(login, shareId)) ?? ''
  } catch {
    return ''
  }
}

export function writeSharedWorkspaceLocalPath(
  login: string,
  shareId: string,
  localPath: string
): void {
  try {
    if (localPath) {
      window.localStorage.setItem(storageKey(login, shareId), localPath)
    } else {
      window.localStorage.removeItem(storageKey(login, shareId))
    }
  } catch {
    // Why: workspace sharing still works when browser storage is unavailable; only path recall is lost.
  }
}
