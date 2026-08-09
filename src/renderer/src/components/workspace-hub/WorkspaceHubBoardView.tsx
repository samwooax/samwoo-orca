import { useMemo } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { CalendarDays, GripVertical, ListTodo, Loader2, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { WorkspaceStatusDefinition } from '../../../../shared/types'
import type { SamwooWorkspaceShare } from '../../../../shared/samwoo-workspace-sharing'
import { canMoveSharedWorkspace } from '../sidebar/shared-workspace-board-status'
import { getWorkspaceStatusVisualMeta } from '../sidebar/workspace-status'
import {
  getSharedWorkspaceDisplayName,
  getSharedWorkspaceInitial,
  hasSharedWorkspaceRemoteChanges
} from './shared-workspace-presentation'
import { formatWorkspaceDueDate, isWorkspaceDueDateOverdue } from './workspace-due-date'

type DropData = {
  kind: 'workspace-share'
  shareId: string
  currentStatus: string
  canMove: boolean
}

type LaneData = {
  kind: 'workspace-status'
  statusId: string
}

export function resolveWorkspaceBoardStatusDrop(
  active: Partial<DropData> | undefined,
  target: Partial<LaneData> | undefined
): { shareId: string; status: string } | null {
  if (
    active?.kind !== 'workspace-share' ||
    target?.kind !== 'workspace-status' ||
    !active.canMove ||
    !active.shareId ||
    !target.statusId ||
    active.currentStatus === target.statusId
  ) {
    return null
  }
  return { shareId: active.shareId, status: target.statusId }
}

function WorkspaceBoardCard({
  share,
  login,
  selected,
  updating,
  onSelect
}: {
  share: SamwooWorkspaceShare
  login: string
  selected: boolean
  updating: boolean
  onSelect: (shareId: string) => void
}): React.JSX.Element {
  const name = getSharedWorkspaceDisplayName(share, login)
  const canMove = Boolean(share.boardStatus) && canMoveSharedWorkspace(share)
  const disabled = !canMove || updating
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef, transform } =
    useDraggable({
      id: `workspace-share:${share.id}`,
      data: {
        kind: 'workspace-share',
        shareId: share.id,
        currentStatus: share.boardStatus ?? '',
        canMove
      } satisfies DropData,
      disabled
    })
  const style = transform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
    : undefined

  return (
    <div
      ref={setNodeRef}
      data-current={selected}
      data-workspace-draggable={!disabled}
      aria-busy={updating}
      className={cn(
        'relative w-full rounded-lg border border-border bg-card text-left shadow-xs transition-colors hover:bg-accent data-[current=true]:ring-1 data-[current=true]:ring-ring',
        isDragging && 'z-10 opacity-75 ring-1 ring-ring',
        disabled && 'cursor-default'
      )}
      style={style}
    >
      <button
        type="button"
        className="w-full p-3 pr-9 text-left"
        onClick={() => onSelect(share.id)}
      >
        <span className="flex items-center gap-2">
          <span className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-foreground/80">
            {getSharedWorkspaceInitial(name)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
          {hasSharedWorkspaceRemoteChanges(share, login) ? (
            <span className="size-1.5 shrink-0 rounded-full bg-status-success" />
          ) : null}
        </span>
        <span className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            {share.dueDate ? (
              <span
                className={cn(
                  'flex items-center gap-1',
                  isWorkspaceDueDateOverdue(share.dueDate) && 'text-destructive'
                )}
              >
                <CalendarDays className="size-3" />
                {formatWorkspaceDueDate(share.dueDate)}
              </span>
            ) : null}
            <span
              className="flex items-center gap-1"
              aria-label={translate(
                'samwoo.workspaceHub.workItemProgress',
                '{{completed}}/{{total}} work items complete',
                {
                  completed: share.completedWorkItemCount ?? 0,
                  total: share.workItemCount ?? 0
                }
              )}
            >
              <ListTodo className="size-3" />
              {share.completedWorkItemCount ?? 0}/{share.workItemCount ?? 0}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="size-3" />
            {share.commentCount ?? 0}
          </span>
        </span>
      </button>
      {updating ? (
        <Loader2 className="absolute top-3 right-3 size-3.5 animate-spin text-muted-foreground" />
      ) : canMove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={setActivatorNodeRef}
              type="button"
              size="icon-xs"
              variant="ghost"
              className="absolute top-2 right-2 touch-none"
              aria-label={translate('samwoo.workspaceSharing.boardStatus', 'Board status')}
              {...attributes}
              {...listeners}
            >
              <GripVertical />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('samwoo.workspaceSharing.boardStatus', 'Board status')}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

function WorkspaceBoardLane({
  status,
  shares,
  login,
  selectedShareId,
  updatingShareId,
  onSelect
}: {
  status: WorkspaceStatusDefinition
  shares: SamwooWorkspaceShare[]
  login: string
  selectedShareId: string | null
  updatingShareId: string | null
  onSelect: (shareId: string) => void
}): React.JSX.Element {
  const visual = getWorkspaceStatusVisualMeta(status)
  const { isOver, setNodeRef } = useDroppable({
    id: `workspace-status:${status.id}`,
    data: { kind: 'workspace-status', statusId: status.id } satisfies LaneData
  })
  return (
    <section
      ref={setNodeRef}
      data-workspace-status={status.id}
      className={cn(
        'min-h-40 rounded-xl bg-muted/40 p-3 transition-shadow',
        visual.laneTint,
        isOver && 'ring-1 ring-ring'
      )}
    >
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span className={cn('size-2 rounded-full', visual.swatch)} />
        {status.label}
        <span className="font-normal">{shares.length}</span>
      </h2>
      <div className="space-y-2">
        {shares.map((share) => (
          <WorkspaceBoardCard
            key={share.id}
            share={share}
            login={login}
            selected={share.id === selectedShareId}
            updating={share.id === updatingShareId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}

export default function WorkspaceHubBoardView({
  shares,
  login,
  statuses,
  selectedShareId,
  updatingShareId,
  onSelect,
  onMoveStatus
}: {
  shares: SamwooWorkspaceShare[]
  login: string
  statuses: readonly WorkspaceStatusDefinition[]
  selectedShareId: string | null
  updatingShareId: string | null
  onSelect: (shareId: string) => void
  onMoveStatus: (shareId: string, status: string) => void
}): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )
  const sharesByStatus = useMemo(() => {
    const firstStatusId = statuses[0]?.id
    const knownStatusIds = new Set(statuses.map((status) => status.id))
    return new Map(
      statuses.map((status) => [
        status.id,
        shares.filter((share) => {
          const shareStatus = share.boardStatus ?? 'todo'
          return (
            shareStatus === status.id ||
            (!knownStatusIds.has(shareStatus) && status.id === firstStatusId)
          )
        })
      ])
    )
  }, [shares, statuses])

  const handleDragEnd = (event: DragEndEvent): void => {
    const move = resolveWorkspaceBoardStatusDrop(
      event.active.data.current as DropData | undefined,
      event.over?.data.current as LaneData | undefined
    )
    if (move) {
      onMoveStatus(move.shareId, move.status)
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="grid min-w-max auto-cols-[280px] grid-flow-col gap-4 p-5">
        {statuses.map((status) => (
          <WorkspaceBoardLane
            key={status.id}
            status={status}
            shares={sharesByStatus.get(status.id) ?? []}
            login={login}
            selectedShareId={selectedShareId}
            updatingShareId={updatingShareId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </DndContext>
  )
}
