import { useEffect, useMemo, useState } from 'react'
import { LayoutList, Loader2, Plus, RefreshCw, SquareKanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import SharedWorkspaceDetails from './SharedWorkspaceDetails'
import WorkspaceHubCreateForm from './WorkspaceHubCreateForm'
import WorkspaceHubViews from './WorkspaceHubViews'
import { useWorkspaceHubCatalog } from './use-workspace-hub-catalog'
import { useWorkspaceHubWideLayout } from './use-workspace-hub-wide-layout'

type ViewMode = 'list' | 'board'

export default function WorkspaceHubPage(): React.JSX.Element {
  const catalog = useWorkspaceHubCatalog()
  const workspaceStatuses = useAppStore((state) => state.workspaceStatuses)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedShareId, setSelectedShareId] = useState<string | null>(null)
  const [nameEditorShareId, setNameEditorShareId] = useState<string | null>(null)
  const wideLayout = useWorkspaceHubWideLayout()
  const selectedShare = useMemo(
    () => catalog.shares.find((share) => share.id === selectedShareId) ?? null,
    [catalog.shares, selectedShareId]
  )

  useEffect(() => {
    if (selectedShareId && !selectedShare) {
      setSelectedShareId(null)
    }
  }, [selectedShare, selectedShareId])

  const details = selectedShare ? (
    <SharedWorkspaceDetails
      key={selectedShare.id}
      share={selectedShare}
      login={catalog.login}
      busy={catalog.refreshing || catalog.createStage !== null}
      focusNameEditor={nameEditorShareId === selectedShare.id}
      onRefresh={catalog.refresh}
      onRevoke={() => catalog.revoke(selectedShare.id)}
      onClose={() => setSelectedShareId(null)}
    />
  ) : null

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">
            {translate('samwoo.workspaceHub.title', 'Workspaces')}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {translate('samwoo.workspaceHub.summary', '{{profile}} profile · {{count}} shared', {
              profile: catalog.profile,
              count: catalog.shares.length
            })}
            {catalog.newChangesCount > 0
              ? ` · ${translate('samwoo.workspaceHub.newChangesCount', '{{count}} new', {
                  count: catalog.newChangesCount
                })}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ButtonGroup aria-label={translate('samwoo.workspaceHub.viewMode', 'View mode')}>
            <Button
              size="sm"
              variant={viewMode === 'list' ? 'secondary' : 'outline'}
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            >
              <LayoutList /> {translate('samwoo.workspaceHub.viewList', 'List')}
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'board' ? 'secondary' : 'outline'}
              aria-pressed={viewMode === 'board'}
              onClick={() => setViewMode('board')}
            >
              <SquareKanban /> {translate('samwoo.workspaceHub.viewBoard', 'Board')}
            </Button>
          </ButtonGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="outline"
                disabled={catalog.refreshing || catalog.createStage !== null}
                aria-label={translate('samwoo.workspaceSharing.refresh', 'Refresh')}
                onClick={() => void catalog.refresh()}
              >
                {catalog.refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate('samwoo.workspaceSharing.refresh', 'Refresh')}
            </TooltipContent>
          </Tooltip>
          <Button onClick={() => setCreateOpen((open) => !open)} aria-expanded={createOpen}>
            <Plus /> {translate('samwoo.workspaceSharing.newShare', 'New share')}
          </Button>
        </div>
      </header>

      {createOpen ? (
        <WorkspaceHubCreateForm
          shareableRepos={catalog.shareableRepos}
          repoId={catalog.repoId}
          displayName={catalog.displayName}
          permission={catalog.permission}
          createStage={catalog.createStage}
          onRepoChange={catalog.setRepoId}
          onDisplayNameChange={catalog.setDisplayName}
          onPermissionChange={catalog.setPermission}
          onCreate={() => {
            void catalog.create().then((created) => {
              if (created) {
                setCreateOpen(false)
              }
            })
          }}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="min-w-0 flex-1 overflow-auto scrollbar-sleek">
          <WorkspaceHubViews
            mode={viewMode}
            shares={catalog.shares}
            login={catalog.login}
            statuses={workspaceStatuses}
            selectedShareId={selectedShareId}
            onSelect={(shareId) => {
              setNameEditorShareId(null)
              setSelectedShareId(shareId)
            }}
            onEditName={(shareId) => {
              setNameEditorShareId(shareId)
              setSelectedShareId(shareId)
            }}
            onRevoke={(shareId) => {
              void catalog.revoke(shareId).then((revoked) => {
                if (revoked && selectedShareId === shareId) {
                  setSelectedShareId(null)
                }
              })
            }}
          />
        </section>
        {wideLayout && details ? (
          <aside className="w-[330px] shrink-0 border-l border-border">{details}</aside>
        ) : null}
      </div>

      {!wideLayout ? (
        <Sheet
          open={Boolean(selectedShare)}
          onOpenChange={(open) => !open && setSelectedShareId(null)}
        >
          <SheetContent className="w-[330px] p-0" showCloseButton={false}>
            <SheetHeader className="sr-only">
              <SheetTitle>
                {translate('samwoo.workspaceHub.details', 'Workspace details')}
              </SheetTitle>
              <SheetDescription>
                {translate(
                  'samwoo.workspaceHub.detailsDescription',
                  'Edit, sync, comment on, or revoke this shared workspace.'
                )}
              </SheetDescription>
            </SheetHeader>
            {details}
          </SheetContent>
        </Sheet>
      ) : null}
    </main>
  )
}
