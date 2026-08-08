import { translate } from '@/i18n/i18n'
import {
  readSharedWorkspaceAlias,
  writeSharedWorkspaceAlias
} from '@/lib/shared-workspace-alias-store'
import { readSharedWorkspaceLocalPath } from '@/lib/shared-workspace-local-path-store'
import { readSharedWorkspaceSeenRevision } from '@/lib/shared-workspace-revision-store'
import type {
  SamwooWorkspacePermission,
  SamwooWorkspaceShare
} from '../../../../shared/samwoo-workspace-sharing'

export function getSamwooWorkspacePermissionLabel(permission: SamwooWorkspacePermission): string {
  switch (permission) {
    case 'view':
      return translate('samwoo.workspaceSharing.permissionView', 'List only')
    case 'download':
      return translate('samwoo.workspaceSharing.permissionDownload', 'Local copy')
    case 'contribute':
      return translate('samwoo.workspaceSharing.permissionContribute', 'Can contribute')
  }
}

export function getSharedWorkspaceDisplayName(share: SamwooWorkspaceShare, login: string): string {
  if (share.isOwner) {
    return share.displayName
  }
  return readSharedWorkspaceAlias(login, share.id).trim() || share.displayName
}

export function writeSharedWorkspaceDisplayName(
  share: SamwooWorkspaceShare,
  login: string,
  value: string
): void {
  if (!share.isOwner) {
    writeSharedWorkspaceAlias(login, share.id, value)
  }
}

export function getSharedWorkspaceInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '·'
}

export function hasSharedWorkspaceRemoteChanges(
  share: SamwooWorkspaceShare,
  login: string
): boolean {
  if (!readSharedWorkspaceLocalPath(login, share.id)) {
    return false
  }
  const seen = readSharedWorkspaceSeenRevision(login, share.id)
  return seen !== null && share.updatedAt > seen
}

export function formatSharedWorkspaceUpdatedAt(value: number): string {
  return new Date(value).toLocaleDateString()
}
