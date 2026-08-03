import { useEffect, useState } from 'react'
import { Check, ChevronRight, Circle, CircleX, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { TeamChatProgressEvent } from '../../../../shared/hermes-team-chat-progress'

function ActivityIcon({ status }: { status: TeamChatProgressEvent['status'] }): React.JSX.Element {
  if (status === 'completed') {
    return <Check className="size-3.5 text-muted-foreground" />
  }
  if (status === 'failed') {
    return <CircleX className="size-3.5 text-destructive" />
  }
  if (status === 'in_progress') {
    return <LoaderCircle className="size-3.5 animate-spin text-foreground/70" />
  }
  return <Circle className="size-3.5 text-muted-foreground/60" />
}

export function HermesTeamChatActivity({
  events,
  busy
}: {
  events: TeamChatProgressEvent[]
  busy: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (busy) {
      setOpen(true)
    }
  }, [busy])

  if (!events.length) {
    return null
  }

  const completed = events.filter((event) => event.status === 'completed').length
  const failed = events.filter((event) => event.status === 'failed').length
  const summary = busy
    ? translate('auto.components.HermesTeamChatActivity.running', 'Working · {{value0}} steps', {
        value0: events.length
      })
    : failed
      ? translate('auto.components.HermesTeamChatActivity.failed', 'Finished · {{value0}} failed', {
          value0: failed
        })
      : translate(
          'auto.components.HermesTeamChatActivity.completed',
          'Completed · {{value0}} steps',
          { value0: completed }
        )

  return (
    <div className="shrink-0 px-3 pb-2 sm:px-4" aria-live="polite">
      <div className="mx-auto w-full max-w-4xl rounded-lg border border-border bg-muted/30">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          <span>{summary}</span>
        </button>
        {open ? (
          <div className="scrollbar-sleek max-h-44 space-y-1 overflow-y-auto border-t border-border/70 px-3 py-2">
            {events.map((event) => (
              <div key={event.id} className="flex min-w-0 items-start gap-2 py-0.5">
                <span className="mt-0.5 shrink-0">
                  <ActivityIcon status={event.status} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs text-foreground/90" title={event.title}>
                    {event.title}
                  </div>
                  {event.detail ? (
                    <div
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={event.detail}
                    >
                      {event.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
