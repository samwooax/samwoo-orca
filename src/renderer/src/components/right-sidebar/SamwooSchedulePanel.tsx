import React, { useCallback, useMemo, useState } from 'react'
import { CalendarClock, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooScheduleStore } from '@/lib/samwoo-schedule-store'
import { runSamwooScheduleNow } from '@/lib/samwoo-schedule-runner'
import {
  nextOccurrenceAt,
  SAMWOO_SCHEDULE_MAX_COUNT,
  SAMWOO_SCHEDULE_PROMPT_MAX_CHARS,
  type SamwooSchedule,
  type SamwooScheduleRun
} from '../../../../shared/samwoo-schedule'
import { SamwooScheduleDayPicker, weekdayLabels } from './samwoo-schedule-day-picker'

function formatNextRun(schedule: SamwooSchedule, nowMs: number): string {
  if (!schedule.enabled) {
    return translate('samwoo.schedules.paused', 'Paused')
  }
  const at = nextOccurrenceAt(schedule, nowMs)
  return at === null
    ? translate('samwoo.schedules.invalidTime', 'Invalid time')
    : new Date(at).toLocaleString()
}

function runSummary(run: SamwooScheduleRun | undefined): string | null {
  if (!run) {
    return null
  }
  const when = new Date(run.finishedAt).toLocaleString()
  if (run.status === 'ok') {
    return translate('samwoo.schedules.lastRunOk', 'Last run {{when}} · done', { when })
  }
  if (run.status === 'skipped') {
    return translate('samwoo.schedules.lastRunSkipped', 'Skipped {{when}} · app was closed', {
      when
    })
  }
  return translate('samwoo.schedules.lastRunError', 'Failed {{when}} · {{detail}}', {
    when,
    detail: run.detail.slice(0, 120)
  })
}

function runNowError(reason: 'signed-out' | 'already-running' | undefined): string {
  if (reason === 'signed-out') {
    return translate('samwoo.schedules.runSignedOut', 'Sign in before running a schedule.')
  }
  if (reason === 'already-running') {
    return translate('samwoo.schedules.alreadyRunning', 'This schedule is already running.')
  }
  return translate('samwoo.schedules.runFailed', 'Could not run.')
}

function ScheduleRow({ schedule }: { schedule: SamwooSchedule }): React.JSX.Element {
  const run = useSamwooScheduleStore((state) => state.runs[schedule.id])
  const updateSchedule = useSamwooScheduleStore((state) => state.updateSchedule)
  const removeSchedule = useSamwooScheduleStore((state) => state.removeSchedule)
  const [running, setRunning] = useState(false)
  const summary = runSummary(run)

  const handleRunNow = useCallback(async () => {
    setRunning(true)
    const result = await runSamwooScheduleNow(schedule)
    setRunning(false)
    if (result.ok) {
      toast.success(translate('samwoo.schedules.ranNow', 'Sent to the team bot.'))
    } else {
      toast.error(result.error ?? runNowError(result.reason))
    }
  }, [schedule])

  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-xs leading-5 text-foreground">{schedule.prompt}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {schedule.time} · {weekdayLabels(schedule.days)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {translate('samwoo.schedules.nextRun', 'Next: {{when}}', {
              when: formatNextRun(schedule, Date.now())
            })}
          </div>
          {summary ? (
            <div
              className={cn(
                'mt-1 line-clamp-2 text-[11px]',
                run?.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {summary}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={running}
                aria-label={translate('samwoo.schedules.runNow', 'Run now')}
                onClick={() => void handleRunNow()}
              >
                <Play className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {translate('samwoo.schedules.runNow', 'Run now')}
            </TooltipContent>
          </Tooltip>
          <Button
            size="xs"
            variant={schedule.enabled ? 'secondary' : 'outline'}
            aria-pressed={schedule.enabled}
            onClick={() => updateSchedule(schedule.id, { enabled: !schedule.enabled })}
          >
            {schedule.enabled
              ? translate('samwoo.schedules.on', 'On')
              : translate('samwoo.schedules.off', 'Off')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={translate('samwoo.schedules.remove', 'Delete schedule')}
                onClick={() => removeSchedule(schedule.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {translate('samwoo.schedules.remove', 'Delete schedule')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export default function SamwooSchedulePanel(): React.JSX.Element {
  const signedIn = useSamwooAuthStore((state) => Boolean(state.auth))
  const schedules = useSamwooScheduleStore((state) => state.schedules)
  const addSchedule = useSamwooScheduleStore((state) => state.addSchedule)
  const [prompt, setPrompt] = useState('')
  const [time, setTime] = useState('08:00')
  const [days, setDays] = useState<number[]>([])

  const atCapacity = schedules.length >= SAMWOO_SCHEDULE_MAX_COUNT
  const canSubmit = prompt.trim().length > 0 && !atCapacity

  const sorted = useMemo(
    () => [...schedules].sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt),
    [schedules]
  )

  const handleAdd = useCallback(() => {
    if (!addSchedule({ prompt, time, days })) {
      toast.error(translate('samwoo.schedules.addFailed', 'Check the time and try again.'))
      return
    }
    setPrompt('')
  }, [addSchedule, days, prompt, time])

  if (!signedIn) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {translate('samwoo.schedules.signedOut', 'Sign in to SAMWOO to use schedules.')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CalendarClock className="size-4 shrink-0" />
          {translate('samwoo.schedules.title', 'Scheduled prompts')}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {translate(
            'samwoo.schedules.appOnlyNotice',
            'Schedules run only while this app is open. A missed time is caught up on the next launch within 12 hours.'
          )}
        </p>
      </div>

      <div className="border-b border-border px-3 py-2">
        <Textarea
          value={prompt}
          maxLength={SAMWOO_SCHEDULE_PROMPT_MAX_CHARS}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder={translate(
            'samwoo.schedules.promptPlaceholder',
            'e.g. Summarize this morning’s mail and post it to the team channel.'
          )}
          className="text-xs"
        />
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            aria-label={translate('samwoo.schedules.time', 'Time')}
            className="h-7 w-[7.5rem] text-xs"
          />
          <SamwooScheduleDayPicker days={days} onChange={setDays} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {atCapacity
              ? translate('samwoo.schedules.atCapacity', 'Limit of {{count}} reached', {
                  count: SAMWOO_SCHEDULE_MAX_COUNT
                })
              : ''}
          </span>
          <Button size="xs" disabled={!canSubmit} onClick={handleAdd}>
            {translate('samwoo.schedules.add', 'Add schedule')}
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="text-sm font-medium text-foreground">
            {translate('samwoo.schedules.emptyTitle', 'No schedules yet')}
          </div>
          <div className="mt-2 max-w-[16rem] text-xs leading-5 text-muted-foreground">
            {translate(
              'samwoo.schedules.emptyBody',
              'Write the instruction the way you would say it in chat. The bot runs it at the time you pick.'
            )}
          </div>
        </div>
      ) : (
        <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
          {sorted.map((schedule) => (
            <ScheduleRow key={schedule.id} schedule={schedule} />
          ))}
        </div>
      )}
    </div>
  )
}
