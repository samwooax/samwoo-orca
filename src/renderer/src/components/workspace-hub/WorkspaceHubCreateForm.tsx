import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { Repo } from '../../../../shared/types'
import type { SamwooWorkspacePermission } from '../../../../shared/samwoo-workspace-sharing'
import { getSamwooWorkspacePermissionLabel } from './shared-workspace-presentation'

type Props = {
  shareableRepos: { repo: Repo; selectionKey: string }[]
  repoId: string
  displayName: string
  permission: SamwooWorkspacePermission
  createStage: 'create' | 'upload' | null
  onRepoChange: (value: string) => void
  onDisplayNameChange: (value: string) => void
  onPermissionChange: (value: SamwooWorkspacePermission) => void
  onCreate: () => void
}

export default function WorkspaceHubCreateForm({
  shareableRepos,
  repoId,
  displayName,
  permission,
  createStage,
  onRepoChange,
  onDisplayNameChange,
  onPermissionChange,
  onCreate
}: Props): React.JSX.Element {
  const selectedRepo = shareableRepos.find((item) => item.selectionKey === repoId)?.repo
  return (
    <section className="grid gap-3 border-b border-border bg-muted/30 px-6 py-4 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_160px_auto] lg:items-end">
      <div className="space-y-2">
        <Label>{translate('samwoo.workspaceSharing.project', 'Project to share')}</Label>
        <Select
          value={repoId}
          onValueChange={(value) => {
            onRepoChange(value)
            onDisplayNameChange(
              shareableRepos.find((item) => item.selectionKey === value)?.repo.displayName ?? ''
            )
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={translate(
                'samwoo.workspaceSharing.localProjectPlaceholder',
                'Select a local project'
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {shareableRepos.map(({ repo, selectionKey }) => (
              <SelectItem key={selectionKey} value={selectionKey}>
                {repo.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="workspace-hub-shared-name">
          {translate('samwoo.workspaceSharing.sharedName', 'Shared name')}
        </Label>
        <Input
          id="workspace-hub-shared-name"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>{translate('samwoo.workspaceSharing.permission', 'Permission')}</Label>
        <Select
          value={permission}
          onValueChange={(value) => onPermissionChange(value as SamwooWorkspacePermission)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['view', 'download', 'contribute'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {getSamwooWorkspacePermissionLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        className="w-44"
        disabled={createStage !== null || !selectedRepo || !displayName.trim()}
        onClick={onCreate}
      >
        {createStage ? <Loader2 className="animate-spin" /> : <Plus />}
        {createStage === 'create'
          ? translate('samwoo.workspaceSharing.creating', 'Creating share…')
          : createStage === 'upload'
            ? translate('samwoo.workspaceSharing.uploadingInitial', 'Uploading files…')
            : translate('samwoo.workspaceSharing.share', 'Share with profile')}
      </Button>
    </section>
  )
}
