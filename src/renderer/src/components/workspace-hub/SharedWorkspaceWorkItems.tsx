import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { isSamwooSessionError } from '@/lib/samwoo-session-validation'
import { cn } from '@/lib/utils'
import type { SamwooProfileMember } from '../../../../shared/samwoo-profile-members'
import type {
  SamwooWorkspaceShareResult,
  SamwooWorkspaceWorkItem
} from '../../../../shared/samwoo-workspace-sharing'
import WorkspaceAssigneePicker from './WorkspaceAssigneePicker'

type Props = {
  shareId: string
  token: string
  canEdit: boolean
  members: readonly SamwooProfileMember[]
  onSummaryRefresh: () => Promise<void>
}

export default function SharedWorkspaceWorkItems({
  shareId,
  token,
  canEdit,
  members,
  onSummaryRefresh
}: Props): React.JSX.Element {
  const logout = useSamwooAuthStore((state) => state.logout)
  const [items, setItems] = useState<SamwooWorkspaceWorkItem[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const activeShareId = useRef(shareId)
  activeShareId.current = shareId

  const showFailure = useCallback(
    (result: SamwooWorkspaceShareResult): void => {
      if (isSamwooSessionError(result.error)) {
        void logout()
        return
      }
      toast.error(
        result.error ??
          translate('samwoo.workspaceHub.workItemUpdateFailed', 'Could not update work items.')
      )
    },
    [logout]
  )

  const refresh = useCallback(
    async (background = false): Promise<void> => {
      const sequence = ++requestSequence.current
      if (!background) {
        setLoading(true)
      }
      try {
        const result = await window.api.preflight.samwooWorkspaceShares.listWorkItems({
          token,
          shareId
        })
        if (sequence !== requestSequence.current) {
          return
        }
        if (!result.ok) {
          showFailure(result)
          return
        }
        setItems(result.workItems ?? [])
      } catch (error) {
        if (sequence === requestSequence.current) {
          toast.error(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!background && sequence === requestSequence.current) {
          setLoading(false)
        }
      }
    },
    [shareId, showFailure, token]
  )

  useEffect(() => {
    setTitle('')
    setBusyItemId(null)
    setCreating(false)
    void refresh()
    const intervalId = window.setInterval(() => void refresh(true), 15_000)
    return () => {
      window.clearInterval(intervalId)
      requestSequence.current += 1
    }
  }, [refresh])

  const commitItem = async (
    itemId: string,
    request: Promise<SamwooWorkspaceShareResult>
  ): Promise<void> => {
    const requestShareId = shareId
    requestSequence.current += 1
    setLoading(false)
    setBusyItemId(itemId)
    try {
      const result = await request
      if (activeShareId.current !== requestShareId) {
        return
      }
      if (!result.ok || !result.workItem) {
        showFailure(result)
        return
      }
      setItems((current) =>
        current.map((item) => (item.id === result.workItem?.id ? result.workItem : item))
      )
      await onSummaryRefresh()
    } catch (error) {
      if (activeShareId.current === requestShareId) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (activeShareId.current === requestShareId) {
        setBusyItemId(null)
      }
    }
  }

  const createItem = async (): Promise<void> => {
    const nextTitle = title.trim()
    if (!canEdit || !nextTitle || creating) {
      return
    }
    requestSequence.current += 1
    setLoading(false)
    setCreating(true)
    const requestShareId = shareId
    try {
      const result = await window.api.preflight.samwooWorkspaceShares.createWorkItem({
        token,
        shareId,
        title: nextTitle
      })
      if (activeShareId.current !== requestShareId) {
        return
      }
      if (!result.ok || !result.workItem) {
        showFailure(result)
        return
      }
      setItems((current) => [...current, result.workItem as SamwooWorkspaceWorkItem])
      setTitle('')
      await onSummaryRefresh()
    } catch (error) {
      if (activeShareId.current === requestShareId) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (activeShareId.current === requestShareId) {
        setCreating(false)
      }
    }
  }

  const completedCount = items.filter((item) => item.completed).length
  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-medium">
          {translate('samwoo.workspaceHub.workItems', 'Work items')}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {completedCount}/{items.length}
        </span>
      </div>

      {loading ? (
        <div className="flex h-12 items-center justify-center text-muted-foreground">
          <Loader2 className="animate-spin" />
        </div>
      ) : items.length ? (
        <div className="space-y-1">
          {items.map((item) => {
            const busy = busyItemId === item.id
            return (
              <div key={item.id} className="flex min-h-9 items-center gap-2 rounded-md px-1">
                <Checkbox
                  checked={item.completed}
                  disabled={!canEdit || busy}
                  aria-label={item.title}
                  onCheckedChange={(checked) => {
                    if (typeof checked !== 'boolean') {
                      return
                    }
                    void commitItem(
                      item.id,
                      window.api.preflight.samwooWorkspaceShares.setWorkItemCompleted({
                        token,
                        shareId,
                        workItemId: item.id,
                        completed: checked
                      })
                    )
                  }}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 text-xs',
                    item.completed && 'text-muted-foreground line-through'
                  )}
                >
                  {item.title}
                </span>
                <WorkspaceAssigneePicker
                  members={members}
                  selectedLogins={item.assigneeLogin ? [item.assigneeLogin] : []}
                  canEdit={canEdit}
                  updating={busy}
                  selectionMode="single"
                  onChange={(logins) => {
                    void commitItem(
                      item.id,
                      window.api.preflight.samwooWorkspaceShares.setWorkItemAssignee({
                        token,
                        shareId,
                        workItemId: item.id,
                        assigneeLogin: logins[0] ?? null
                      })
                    )
                  }}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <p className="py-2 text-xs text-muted-foreground">
          {translate('samwoo.workspaceHub.noWorkItems', 'No work items yet.')}
        </p>
      )}

      {canEdit ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void createItem()
          }}
        >
          <Input
            value={title}
            maxLength={300}
            disabled={creating}
            placeholder={translate('samwoo.workspaceHub.addWorkItem', 'Add work item…')}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                event.preventDefault()
              }
            }}
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="outline"
            disabled={creating || !title.trim()}
            aria-label={translate('samwoo.workspaceHub.addWorkItem', 'Add work item')}
          >
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          </Button>
        </form>
      ) : null}
    </section>
  )
}
