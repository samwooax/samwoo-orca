import React from 'react'
import { MessageCircle, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { WorkspaceStatusDefinition } from '../../../../shared/types'
import SidebarFilter from './SidebarFilter'
import WorkspaceKanbanSearchField from './WorkspaceKanbanSearchField'
import WorkspaceKanbanSettingsMenu from './WorkspaceKanbanSettingsMenu'
import { translate } from '@/i18n/i18n'

type WorkspaceKanbanDrawerHeaderProps = {
  selectedCount: number
  query: string
  isFiltering: boolean
  isTooLarge: boolean
  matchCount: number
  totalCount: number
  onQueryChange: (query: string) => void
  onClearQuery: () => void
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  syncTaskStatusFromWorkspaceBoard: boolean
  onSyncTaskStatusFromWorkspaceBoardChange: (enabled: boolean) => void
  onRenameStatus: (statusId: string, label: string) => void
  onChangeStatusColor: (statusId: string, color: string) => void
  onChangeStatusIcon: (statusId: string, icon: string) => void
  onMoveStatus: (statusId: string, direction: -1 | 1) => void
  onRemoveStatus: (statusId: string) => void
  onAddStatus: () => void
  onFilterMenuOpenChange: (open: boolean) => void
  onOpenSharedWorkspaces: () => void
  sharedWorkspaceChangeCount?: number
  onOpenMessages?: () => void
  unreadMessageCount?: number
  onClose: () => void
}

export default function WorkspaceKanbanDrawerHeader({
  selectedCount,
  query,
  isFiltering,
  isTooLarge,
  matchCount,
  totalCount,
  onQueryChange,
  onClearQuery,
  workspaceStatuses,
  syncTaskStatusFromWorkspaceBoard,
  onSyncTaskStatusFromWorkspaceBoardChange,
  onRenameStatus,
  onChangeStatusColor,
  onChangeStatusIcon,
  onMoveStatus,
  onRemoveStatus,
  onAddStatus,
  onFilterMenuOpenChange,
  onOpenSharedWorkspaces,
  sharedWorkspaceChangeCount = 0,
  onOpenMessages,
  unreadMessageCount = 0,
  onClose
}: WorkspaceKanbanDrawerHeaderProps): React.JSX.Element {
  return (
    <>
      <SheetHeader className="border-b border-worktree-sidebar-border px-4 py-3 pr-40">
        {/* Why: SheetTitle is the sheet's aria-labelledby target and renders an
            <h2>, so the field must be its sibling, not a descendant. */}
        <div className="flex items-center gap-2">
          <SheetTitle className="flex shrink-0 items-center gap-2 text-sm">
            <span>
              {translate(
                'auto.components.sidebar.WorkspaceKanbanDrawerHeader.c6a77ab0f4',
                'Workspace board'
              )}
            </span>
            {selectedCount > 1 ? (
              <span className="rounded-full bg-worktree-sidebar-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {selectedCount}{' '}
                {translate(
                  'auto.components.sidebar.WorkspaceKanbanDrawerHeader.81870af08f',
                  'selected'
                )}
              </span>
            ) : null}
          </SheetTitle>
          <WorkspaceKanbanSearchField
            query={query}
            isFiltering={isFiltering}
            isTooLarge={isTooLarge}
            matchCount={matchCount}
            totalCount={totalCount}
            onQueryChange={onQueryChange}
            onClear={onClearQuery}
            onClose={onClose}
          />
        </div>
        <SheetDescription className="sr-only">
          {translate(
            'auto.components.sidebar.WorkspaceKanbanDrawerHeader.e1a34450fc',
            'Organize workspaces by status and open workspace cards.'
          )}
        </SheetDescription>
      </SheetHeader>

      <div className="absolute right-3 top-2.5 flex items-center gap-1">
        {onOpenMessages ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="relative"
            aria-label={
              unreadMessageCount
                ? translate('samwoo.profileMessages.unreadButton', 'Messages, {{count}} unread', {
                    count: unreadMessageCount
                  })
                : translate('samwoo.profileMessages.title', 'Messages')
            }
            onClick={onOpenMessages}
          >
            <MessageCircle className="size-3.5" />
            {unreadMessageCount ? (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] leading-3.5 text-primary-foreground">
                {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
              </span>
            ) : null}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          className="relative"
          aria-label={
            sharedWorkspaceChangeCount
              ? translate(
                  'samwoo.workspaceSharing.newChangesButton',
                  'Team shared workspaces, new changes'
                )
              : translate('samwoo.workspaceSharing.title', 'Team shared workspaces')
          }
          onClick={onOpenSharedWorkspaces}
        >
          <Users className="size-3.5" />
          {sharedWorkspaceChangeCount ? (
            <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary" />
          ) : null}
        </Button>
        <SidebarFilter
          preserveWorkspaceBoardOpen
          tooltipSide="top"
          contentSide="bottom"
          onMenuOpenChange={onFilterMenuOpenChange}
        />
        <WorkspaceKanbanSettingsMenu
          workspaceStatuses={workspaceStatuses}
          syncTaskStatusFromWorkspaceBoard={syncTaskStatusFromWorkspaceBoard}
          onSyncTaskStatusFromWorkspaceBoardChange={onSyncTaskStatusFromWorkspaceBoardChange}
          onRenameStatus={onRenameStatus}
          onChangeStatusColor={onChangeStatusColor}
          onChangeStatusIcon={onChangeStatusIcon}
          onMoveStatus={onMoveStatus}
          onRemoveStatus={onRemoveStatus}
          onAddStatus={onAddStatus}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.sidebar.WorkspaceKanbanDrawerHeader.f369f5c5a3',
            'Close'
          )}
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </>
  )
}
