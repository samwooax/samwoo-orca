import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, MessageSquare, RefreshCw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { SamwooWorkspaceComment } from '../../../../shared/samwoo-workspace-sharing'

type Props = {
  shareId: string
  token: string
  initialCount: number
}

// Why: the central catalog has no push channel, so refresh open threads without user action.
const REFRESH_INTERVAL_MS = 15_000

export default function SharedWorkspaceComments({
  shareId,
  token,
  initialCount
}: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [comments, setComments] = useState<SamwooWorkspaceComment[]>([])
  const [knownCount, setKnownCount] = useState(initialCount)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const totalCount = expanded ? comments.length : knownCount
  const completedCount = useMemo(
    () => comments.filter((comment) => comment.completed).length,
    [comments]
  )

  useEffect(() => setKnownCount((current) => Math.max(current, initialCount)), [initialCount])

  const refresh = useCallback(
    async (showProgress = false): Promise<void> => {
      if (showProgress) {
        setLoading(true)
      }
      const result = await window.api.preflight.samwooWorkspaceShares.listComments({
        token,
        shareId
      })
      if (showProgress) {
        setLoading(false)
      }
      if (result.ok) {
        const nextComments = result.comments ?? []
        setComments(nextComments)
        setKnownCount(nextComments.length)
      } else if (showProgress) {
        toast.error(
          result.error ??
            translate('samwoo.workspaceSharing.commentsLoadFailed', 'Could not load comments.')
        )
      }
    },
    [shareId, token]
  )

  useEffect(() => {
    if (!expanded) {
      return
    }
    void refresh(true)
    const interval = window.setInterval(() => void refresh(false), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [expanded, refresh])

  const createComment = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const body = draft.trim()
    if (!body || submitting) {
      return
    }
    setSubmitting(true)
    const result = await window.api.preflight.samwooWorkspaceShares.createComment({
      token,
      shareId,
      body
    })
    setSubmitting(false)
    if (!result.ok || !result.comment) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.commentCreateFailed', 'Could not add the comment.')
      )
      return
    }
    const createdComment = result.comment
    setComments((current) => [...current, createdComment])
    setKnownCount((current) => current + 1)
    setDraft('')
  }

  const setCompleted = async (
    comment: SamwooWorkspaceComment,
    completed: boolean
  ): Promise<void> => {
    if (togglingId) {
      return
    }
    setTogglingId(comment.id)
    const result = await window.api.preflight.samwooWorkspaceShares.setCommentCompleted({
      token,
      shareId,
      commentId: comment.id,
      completed
    })
    setTogglingId(null)
    if (!result.ok || !result.comment) {
      toast.error(
        result.error ??
          translate(
            'samwoo.workspaceSharing.commentStatusFailed',
            'Could not update the progress status.'
          )
      )
      return
    }
    const updatedComment = result.comment
    setComments((current) =>
      current.map((item) => (item.id === comment.id ? updatedComment : item))
    )
  }

  return (
    <div className="border-t border-border pt-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="w-full justify-start"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <MessageSquare />
        {translate('samwoo.workspaceSharing.comments', 'Comments')} ({totalCount})
        {expanded && comments.length ? (
          <>
            <span className="ml-auto text-xs text-muted-foreground">
              {translate('samwoo.workspaceSharing.commentProgress', '{{done}}/{{total}} complete', {
                done: completedCount,
                total: comments.length
              })}
            </span>
            <ChevronUp />
          </>
        ) : (
          <span className="ml-auto">{expanded ? <ChevronUp /> : <ChevronDown />}</span>
        )}
      </Button>
      {expanded ? (
        <div className="mt-2 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {translate(
                'samwoo.workspaceSharing.commentsScope',
                'Visible to members of this Hermes profile.'
              )}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={loading}
                  aria-label={translate(
                    'samwoo.workspaceSharing.refreshComments',
                    'Refresh comments'
                  )}
                  onClick={() => void refresh(true)}
                >
                  {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {translate('samwoo.workspaceSharing.refreshComments', 'Refresh comments')}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="max-h-56 space-y-0 overflow-y-auto scrollbar-sleek">
            {comments.length ? (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="flex gap-2 border-b border-border py-2 last:border-0"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={comment.completed}
                    disabled={togglingId !== null}
                    aria-label={translate(
                      'samwoo.workspaceSharing.toggleCommentStatus',
                      'Toggle progress for {{comment}}',
                      { comment: comment.body }
                    )}
                    onCheckedChange={(checked) => void setCompleted(comment, checked === true)}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p
                      className={`whitespace-pre-wrap break-words text-sm ${comment.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                    >
                      {comment.body}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {comment.authorLogin} · {formatCommentTime(comment.createdAt)}
                      {comment.completed && comment.completedBy
                        ? ` · ${translate(
                            'samwoo.workspaceSharing.completedBy',
                            'Completed by {{name}}',
                            { name: comment.completedBy }
                          )}`
                        : ''}
                    </p>
                  </div>
                </div>
              ))
            ) : loading ? null : (
              <p className="py-3 text-center text-xs text-muted-foreground">
                {translate('samwoo.workspaceSharing.commentsEmpty', 'No comments yet.')}
              </p>
            )}
          </div>
          <form className="flex items-end gap-2" onSubmit={(event) => void createComment(event)}>
            <Textarea
              className="min-h-16 resize-none"
              maxLength={2000}
              value={draft}
              placeholder={translate(
                'samwoo.workspaceSharing.commentPlaceholder',
                'Add a comment or work item…'
              )}
              aria-label={translate('samwoo.workspaceSharing.commentPlaceholder', 'Add a comment')}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={submitting || !draft.trim()}>
              {submitting ? <Loader2 className="animate-spin" /> : <Send />}
              {translate('samwoo.workspaceSharing.addComment', 'Add comment')}
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  )
}

function formatCommentTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}
