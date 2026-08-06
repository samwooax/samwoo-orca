import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { SamwooWorkspaceConflictChoice } from '../../../../shared/samwoo-workspace-sharing'

type Props = {
  open: boolean
  paths: string[]
  canWrite: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onResolve: (choices: { path: string; choice: SamwooWorkspaceConflictChoice }[]) => void
}

export default function SharedWorkspaceConflictDialog({
  open,
  paths,
  canWrite,
  busy,
  onOpenChange,
  onResolve
}: Props): React.JSX.Element {
  const [choices, setChoices] = useState<Record<string, SamwooWorkspaceConflictChoice>>({})
  useEffect(() => {
    setChoices(
      Object.fromEntries(paths.map((filePath) => [filePath, canWrite ? 'keep_both' : 'use_remote']))
    )
  }, [canWrite, paths])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate('samwoo.workspaceSharing.resolveTitle', 'Resolve file conflicts')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'samwoo.workspaceSharing.resolveDescription',
              'Choose which version to keep for each file. Keeping both is the safest option.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto scrollbar-sleek">
          {paths.map((filePath) => (
            <div
              key={filePath}
              className="grid items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,1fr)_220px]"
            >
              <span className="truncate font-mono text-xs">{filePath}</span>
              <Select
                value={choices[filePath]}
                onValueChange={(value) =>
                  setChoices((current) => ({
                    ...current,
                    [filePath]: value as SamwooWorkspaceConflictChoice
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {canWrite ? (
                    <SelectItem value="keep_both">
                      {translate('samwoo.workspaceSharing.keepBoth', 'Keep both')}
                    </SelectItem>
                  ) : null}
                  <SelectItem value="use_remote">
                    {translate('samwoo.workspaceSharing.useRemote', 'Use cloud version')}
                  </SelectItem>
                  {canWrite ? (
                    <SelectItem value="keep_local">
                      {translate('samwoo.workspaceSharing.keepLocal', 'Replace cloud with local')}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {translate('samwoo.workspaceSharing.resolveLater', 'Resolve later')}
          </Button>
          <Button
            disabled={busy || !paths.length}
            onClick={() =>
              onResolve(paths.map((filePath) => ({ path: filePath, choice: choices[filePath] })))
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {translate('samwoo.workspaceSharing.applyResolution', 'Apply resolutions')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
