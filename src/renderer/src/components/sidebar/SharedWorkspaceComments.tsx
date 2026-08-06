import React, { useCallback, useEffect, useRef, useState } from 'react'
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
const COMMENT_LABEL_LENGTH = 80

export default function SharedWorkspaceComments({
  shareId,
  token,
  initialCount
}: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [comments, setComments] = useState<SamwooWorkspaceComment[]>([])
  const [knownCount, setKnownCount] = useState(initialCount)
  const [knownCompletedCount, setKnownCompletedCount] = useState(0)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const commentsRef = useRef<SamwooWorkspaceComment[]>([])
  const requestSequenceRef = useRef(0)
  const appliedRequestRef = useRef(0)
  const mutationVersionRef = useRef(0)
  const olderCursorRef = useRef<{ createdAt: number; id: string } | null>(null)
  const totalCount = knownCount

  useEffect(() => setKnownCount((current) => Math.max(current, initialCount)), [initialCount])

  const refresh = useCallback(
    async (showProgress = false): Promise<void> => {
      const requestId = ++requestSequenceRef.current
      const mutationVersion = mutationVersionRef.current
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
      const isCurrent =
        requestId > appliedRequestRef.current && mutationVersion === mutationVersionRef.current
      if (result.ok && isCurrent) {
        appliedRequestRef.current = requestId
        const nextComments = result.comments ?? []
        const mergedComments = mergeCommentPages(commentsRef.current, nextComments)
        commentsRef.current = mergedComments
        setComments(mergedComments)
        const commentCount = result.commentCount ?? mergedComments.length
        setKnownCount(commentCount)
        setKnownCompletedCount(
          result.completedCommentCount ?? nextComments.filter((comment) => comment.completed).length
        )
        const hasUnloadedComments = commentCount > mergedComments.length
        setHasOlder(hasUnloadedComments)
        if (!hasUnloadedComments) {
          olderCursorRef.current = null
        } else if (
          !olderCursorRef.current &&
          typeof result.nextBeforeCreatedAt === 'number' &&
          result.nextBeforeId
        ) {
          // Why: polling the newest page must not move an in-progress older-page cursor backward.
          olderCursorRef.current = {
            createdAt: result.nextBeforeCreatedAt,
            id: result.nextBeforeId
          }
        }
      } else if (showProgress) {
        if (!result.ok) {
          toast.error(
            result.error ??
              translate('samwoo.workspaceSharing.commentsLoadFailed', 'Could not load comments.')
          )
        }
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

  const loadOlder = async (): Promise<void> => {
    const cursor = olderCursorRef.current
    if (!cursor || loadingOlder) {
      return
    }
    const mutationVersion = mutationVersionRef.current
    setLoadingOlder(true)
    const result = await window.api.preflight.samwooWorkspaceShares.listComments({
      token,
      shareId,
      beforeCreatedAt: cursor.createdAt,
      beforeId: cursor.id
    })
    setLoadingOlder(false)
    if (mutationVersion !== mutationVersionRef.current) {
      return
    }
    if (!result.ok) {
      toast.error(
        result.error ??
          translate('samwoo.workspaceSharing.commentsLoadFailed', 'Could not load comments.')
      )
      return
    }
    const mergedComments = mergeCommentPages(commentsRef.current, result.comments ?? [])
    commentsRef.current = mergedComments
    setComments(mergedComments)
    const commentCount = result.commentCount ?? knownCount
    setKnownCount(commentCount)
    if (result.completedCommentCount !== undefined) {
      setKnownCompletedCount(result.completedCommentCount)
    }
    const hasUnloadedComments = commentCount > mergedComments.length
    setHasOlder(hasUnloadedComments)
    olderCursorRef.current =
      hasUnloadedComments && typeof result.nextBeforeCreatedAt === 'number' && result.nextBeforeId
        ? { createdAt: result.nextBeforeCreatedAt, id: result.nextBeforeId }
        : null
  }

  const createComment = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const body = draft.trim()
    if (!body || submitting) {
      return
    }
    mutationVersionRef.current += 1
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
    mutationVersionRef.current += 1
    const mergedComments = mergeCommentPages(commentsRef.current, [createdComment])
    commentsRef.current = mergedComments
    setComments(mergedComments)
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
    mutationVersionRef.current += 1
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
    mutationVersionRef.current += 1
    setKnownCompletedCount((current) =>
      Math.max(0, current + Number(updatedComment.completed) - Number(comment.completed))
    )
    const mergedComments = mergeCommentPages(commentsRef.current, [updatedComment])
    commentsRef.current = mergedComments
    setComments(mergedComments)
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
                done: knownCompletedCount,
                total: knownCount
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
                      { comment: summarizeComment(comment.body) }
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
          {hasOlder ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-full"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? <Loader2 className="animate-spin" /> : null}
              {translate('samwoo.workspaceSharing.loadOlderComments', 'Load earlier comments')}
            </Button>
          ) : null}
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

function mergeCommentPages(
  current: SamwooWorkspaceComment[],
  incoming: SamwooWorkspaceComment[]
): SamwooWorkspaceComment[] {
  const commentsById = new Map(current.map((comment) => [comment.id, comment]))
  for (const comment of incoming) {
    commentsById.set(comment.id, comment)
  }
  return [...commentsById.values()].sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  )
}

function summarizeComment(body: string): string {
  const singleLine = body.replace(/\s+/g, ' ').trim()
  return singleLine.length > COMMENT_LABEL_LENGTH
    ? `${singleLine.slice(0, COMMENT_LABEL_LENGTH)}…`
    : singleLine
}

function formatCommentTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}
