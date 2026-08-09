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
import { useSamwooWorkspaceAssignmentInboxStore } from '@/lib/samwoo-workspace-assignment-inbox-store'
import { useAppStore } from '@/store'
import SharedWorkspaceDetails from './SharedWorkspaceDetails'
import WorkspaceHubCreateForm from './WorkspaceHubCreateForm'
import WorkspaceHubViews from './WorkspaceHubViews'
import { useWorkspaceHubCatalog } from './use-workspace-hub-catalog'
import { useWorkspaceHubAssignees } from './use-workspace-hub-assignees'
import { useWorkspaceHubBoardStatusUpdate } from './use-workspace-hub-board-status-update'
import { useWorkspaceHubDueDate } from './use-workspace-hub-due-date'
import { useWorkspaceHubWideLayout } from './use-workspace-hub-wide-layout'

type ViewMode = 'list' | 'board'

export default function WorkspaceHubPage(): React.JSX.Element {
  const catalog = useWorkspaceHubCatalog()
  const clearAssignmentInbox = useSamwooWorkspaceAssignmentInboxStore((state) => state.clear)
  const workspaceStatuses = useAppStore((state) => state.workspaceStatuses)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedShareId, setSelectedShareId] = useState<string | null>(null)
  const [nameEditorShareId, setNameEditorShareId] = useState<string | null>(null)
  const wideLayout = useWorkspaceHubWideLayout()
  const boardStatusUpdate = useWorkspaceHubBoardStatusUpdate({
    shares: catalog.shares,
    onRefresh: catalog.refresh
  })
  const assignees = useWorkspaceHubAssignees({
    shares: catalog.shares,
    onRefresh: catalog.refresh
  })
  const dueDate = useWorkspaceHubDueDate({
    shares: catalog.shares,
    onRefresh: catalog.refresh
  })
  const selectedShare = useMemo(
    () => catalog.shares.find((share) => share.id === selectedShareId) ?? null,
    [catalog.shares, selectedShareId]
  )

  useEffect(() => {
    clearAssignmentInbox()
  }, [clearAssignmentInbox])

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
      members={assignees.members}
      updatingAssignees={assignees.updatingShareId === selectedShare.id}
      onUpdateAssignees={(logins) => assignees.updateAssignees(selectedShare.id, logins)}
      updatingDueDate={dueDate.updatingShareId === selectedShare.id}
      onUpdateDueDate={(value) => dueDate.updateDueDate(selectedShare.id, value)}
      onRefresh={catalog.refresh}
      onRevoke={() => catalog.revoke(selectedShare.id)}
      onClose={() => setSelectedShareId(null)}
    />
  ) : null

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-end gap-1 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center justify-end gap-1">
          <ButtonGroup aria-label={translate('samwoo.workspaceHub.viewMode', 'View mode')}>
            <Button
              size="xs"
              variant={viewMode === 'list' ? 'secondary' : 'outline'}
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            >
              <LayoutList /> {translate('samwoo.workspaceHub.viewList', 'List')}
            </Button>
            <Button
              size="xs"
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
                size="icon-xs"
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
          <Button
            size="xs"
            onClick={() => setCreateOpen((open) => !open)}
            aria-expanded={createOpen}
          >
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
            updatingShareId={boardStatusUpdate.updatingShareId}
            members={assignees.members}
            updatingAssigneeShareId={assignees.updatingShareId}
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
            onMoveStatus={(shareId, status) => {
              void boardStatusUpdate.updateBoardStatus(shareId, status)
            }}
            onUpdateAssignees={(shareId, logins) => {
              void assignees.updateAssignees(shareId, logins)
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
