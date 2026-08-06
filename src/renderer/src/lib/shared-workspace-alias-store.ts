const STORAGE_PREFIX = 'samwoo.workspace-share.alias.'

function key(login: string, shareId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(login)}.${shareId}`
}

export function readSharedWorkspaceAlias(login: string, shareId: string): string {
  try {
    return localStorage.getItem(key(login, shareId))?.trim() ?? ''
  } catch {
    return ''
  }
}

export function writeSharedWorkspaceAlias(login: string, shareId: string, alias: string): void {
  try {
    const storageKey = key(login, shareId)
    const trimmed = alias.trim()
    if (trimmed) {
      localStorage.setItem(storageKey, trimmed)
    } else {
      localStorage.removeItem(storageKey)
    }
  } catch {
    // Local aliases are optional and must not block shared workspace access.
  }
}
