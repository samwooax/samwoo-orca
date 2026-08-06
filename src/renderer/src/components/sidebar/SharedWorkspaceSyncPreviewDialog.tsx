import React from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type {
  SamwooWorkspaceChangeKind,
  SamwooWorkspaceSyncDirection,
  SamwooWorkspaceSyncPreview
} from '../../../../shared/samwoo-workspace-sharing'

type Props = {
  open: boolean
  direction: SamwooWorkspaceSyncDirection
  preview: SamwooWorkspaceSyncPreview | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (deletePaths: string[]) => void
}

const KINDS: SamwooWorkspaceChangeKind[] = ['add', 'modify', 'delete', 'conflict']

function kindLabel(kind: SamwooWorkspaceChangeKind): string {
  const labels = {
    add: translate('samwoo.workspaceSharing.changeAdd', 'Add'),
    modify: translate('samwoo.workspaceSharing.changeModify', 'Modify'),
    delete: translate('samwoo.workspaceSharing.changeDelete', 'Delete'),
    conflict: translate('samwoo.workspaceSharing.changeConflict', 'Conflict')
  }
  return labels[kind]
}

export default function SharedWorkspaceSyncPreviewDialog({
  open,
  direction,
  preview,
  busy,
  onOpenChange,
  onConfirm
}: Props): React.JSX.Element {
  const changes = preview?.changes ?? []
  const deletePaths = changes
    .filter((change) => change.kind === 'delete')
    .map((change) => change.path)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {translate('samwoo.workspaceSharing.previewTitle', 'Review workspace changes')}
          </DialogTitle>
          <DialogDescription>
            {direction === 'push'
              ? translate(
                  'samwoo.workspaceSharing.previewPushDescription',
                  'Review what will change in the company cloud before uploading.'
                )
              : translate(
                  'samwoo.workspaceSharing.previewPullDescription',
                  'Review what will change in the local workspace before downloading.'
                )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((kind) => {
            const count = changes.filter((change) => change.kind === kind).length
            return count ? (
              <Badge key={kind} variant={kind === 'delete' ? 'destructive' : 'secondary'}>
                {kindLabel(kind)} {count}
              </Badge>
            ) : null
          })}
        </div>
        <div className="max-h-72 space-y-3 overflow-y-auto scrollbar-sleek">
          {KINDS.map((kind) => {
            const group = changes.filter((change) => change.kind === kind)
            return group.length ? (
              <section key={kind} className="space-y-1 rounded-md border border-border p-3">
                <h4 className="text-xs font-medium">{kindLabel(kind)}</h4>
                {group.map((change) => (
                  <p key={change.path} className="truncate font-mono text-xs text-muted-foreground">
                    {change.path}
                  </p>
                ))}
              </section>
            ) : null
          })}
          {!changes.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {translate('samwoo.workspaceSharing.noChanges', 'No workspace changes found.')}
            </p>
          ) : null}
        </div>
        {deletePaths.length ? (
          <p className="text-xs text-destructive">
            {direction === 'push'
              ? translate(
                  'samwoo.workspaceSharing.cloudDeleteWarning',
                  'Cloud files will be deleted and may remain recoverable under the Nextcloud trash policy.'
                )
              : translate(
                  'samwoo.workspaceSharing.localDeleteWarning',
                  'These files will be removed from the local workspace.'
                )}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {translate('samwoo.workspaceSharing.cancelSync', 'Cancel')}
          </Button>
          <Button disabled={busy || !changes.length} onClick={() => onConfirm(deletePaths)}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {direction === 'push'
              ? translate('samwoo.workspaceSharing.confirmUpload', 'Upload changes')
              : translate('samwoo.workspaceSharing.confirmDownload', 'Get changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
