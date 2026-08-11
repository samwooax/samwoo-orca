import { useCallback, useState } from 'react'
import { Loader2, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { runSamwooScheduleNow } from '@/lib/samwoo-schedule-runner'
import { useSamwooScheduleStore } from '@/lib/samwoo-schedule-store'
import {
  nextOccurrenceAt,
  scheduleFrequency,
  type SamwooSchedule,
  type SamwooScheduleRun
} from '../../../../shared/samwoo-schedule'
import { weekdayLabels } from './samwoo-schedule-day-picker'

function cadenceLabel(schedule: SamwooSchedule): string {
  const frequency = scheduleFrequency(schedule)
  const interval = schedule.interval ?? 1
  if (frequency === 'minutes') {
    return translate('samwoo.schedules.everyMinutes', 'Every {{count}} minutes', {
      count: interval
    })
  }
  if (frequency === 'hours') {
    return translate('samwoo.schedules.everyHours', 'Every {{count}} hours', { count: interval })
  }
  return `${schedule.time} · ${weekdayLabels(schedule.days)}`
}

function runSummary(run: SamwooScheduleRun | undefined): string | null {
  if (!run) {
    return null
  }
  if (run.status === 'skipped') {
    return translate('samwoo.schedules.missedWhileClosed', 'Missed while Orca was closed')
  }
  if (run.status === 'error') {
    return run.detail
  }
  return translate('samwoo.schedules.savedResult', 'Saved: {{path}}', {
    path: run.outputPath ?? ''
  })
}

export function SamwooScheduleRow({
  schedule,
  run
}: {
  schedule: SamwooSchedule
  run: SamwooScheduleRun | undefined
}): React.JSX.Element {
  const updateSchedule = useSamwooScheduleStore((state) => state.updateSchedule)
  const removeSchedule = useSamwooScheduleStore((state) => state.removeSchedule)
  const [pending, setPending] = useState(false)
  const nextRunAt = nextOccurrenceAt(schedule, Date.now())

  const runNow = useCallback(async () => {
    if (schedule.remoteJobId) {
      toast.error(
        translate(
          'samwoo.schedules.migrationPending',
          'The old server schedule must be disabled before local execution.'
        )
      )
      return
    }
    setPending(true)
    const result = await runSamwooScheduleNow(schedule)
    setPending(false)
    if (!result.ok) {
      toast.error(result.error ?? translate('samwoo.schedules.actionFailed', 'Schedule failed.'))
      return
    }
    toast.success(
      translate('samwoo.schedules.resultSaved', 'Result saved: {{path}}', {
        path: result.outputPath ?? ''
      })
    )
  }, [schedule])

  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-xs leading-5 text-foreground">{schedule.prompt}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{cadenceLabel(schedule)}</div>
          {nextRunAt ? (
            <div className="text-[11px] text-muted-foreground">
              {translate('samwoo.schedules.nextRun', 'Next: {{when}}', {
                when: new Date(nextRunAt).toLocaleString()
              })}
            </div>
          ) : null}
          {runSummary(run) ? (
            <div
              className={
                run?.status === 'error'
                  ? 'mt-1 line-clamp-2 text-[11px] text-destructive'
                  : 'mt-1 line-clamp-2 text-[11px] text-muted-foreground'
              }
            >
              {runSummary(run)}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={pending || Boolean(schedule.remoteJobId)}
                aria-label={translate('samwoo.schedules.runNow', 'Run now')}
                onClick={() => void runNow()}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {translate('samwoo.schedules.runNow', 'Run now')}
            </TooltipContent>
          </Tooltip>
          <Button
            size="xs"
            variant={schedule.enabled ? 'secondary' : 'outline'}
            disabled={pending || Boolean(schedule.remoteJobId)}
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
                disabled={pending || Boolean(schedule.remoteJobId)}
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
