import { useCallback, useState } from 'react'
import { Loader2, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useSamwooScheduleStore } from '@/lib/samwoo-schedule-store'
import type { SamwooHermesCronJob } from '../../../../shared/samwoo-hermes-cron'
import { scheduleFrequency, type SamwooSchedule } from '../../../../shared/samwoo-schedule'
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

function remoteSummary(job: SamwooHermesCronJob | undefined): string {
  if (!job) {
    return translate('samwoo.schedules.notRegistered', 'Not registered on Hermes cron')
  }
  if (job.lastRunAt) {
    const status = job.lastStatus ?? translate('samwoo.schedules.statusUnknown', 'unknown')
    return translate('samwoo.schedules.lastRemoteRun', 'Last: {{when}} · {{status}}', {
      when: new Date(job.lastRunAt).toLocaleString(),
      status
    })
  }
  return translate('samwoo.schedules.registeredJob', 'Registered · Job {{id}}', { id: job.id })
}

export function SamwooScheduleRow({
  schedule,
  job,
  profile,
  onRefresh
}: {
  schedule: SamwooSchedule
  job: SamwooHermesCronJob | undefined
  profile: string
  onRefresh: () => Promise<void>
}): React.JSX.Element {
  const updateSchedule = useSamwooScheduleStore((state) => state.updateSchedule)
  const removeSchedule = useSamwooScheduleStore((state) => state.removeSchedule)
  const [pending, setPending] = useState(false)

  const runAction = useCallback(
    async (action: 'pause' | 'resume' | 'run' | 'delete') => {
      if (!job) {
        if (action === 'delete') {
          removeSchedule(schedule.id)
          return
        }
        toast.error(translate('samwoo.schedules.notRegistered', 'Not registered on Hermes cron'))
        return
      }
      setPending(true)
      const result = await window.api.preflight.samwooHermesCron.action({
        profile,
        jobId: job.id,
        action
      })
      setPending(false)
      if (!result.ok) {
        toast.error(
          result.error ?? translate('samwoo.schedules.actionFailed', 'Cron action failed.')
        )
        return
      }
      if (action === 'delete') {
        removeSchedule(schedule.id)
        toast.success(translate('samwoo.schedules.removedRemote', 'Hermes cron job deleted.'))
        return
      }
      if (action === 'pause' || action === 'resume') {
        updateSchedule(schedule.id, { enabled: action === 'resume' })
      }
      toast.success(
        action === 'run'
          ? translate('samwoo.schedules.runQueued', 'Queued for the next Hermes cron tick.')
          : translate('samwoo.schedules.actionVerified', 'Hermes cron state verified.')
      )
      await onRefresh()
    },
    [job, onRefresh, profile, removeSchedule, schedule.id, updateSchedule]
  )

  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-xs leading-5 text-foreground">{schedule.prompt}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{cadenceLabel(schedule)}</div>
          <div className="text-[11px] text-muted-foreground">
            {job?.nextRunAt
              ? translate('samwoo.schedules.nextRun', 'Next: {{when}}', {
                  when: new Date(job.nextRunAt).toLocaleString()
                })
              : remoteSummary(job)}
          </div>
          {job?.nextRunAt ? (
            <div className="text-[11px] text-muted-foreground">{remoteSummary(job)}</div>
          ) : null}
          {job?.lastError ? (
            <div className="mt-1 line-clamp-2 text-[11px] text-destructive">{job.lastError}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={pending || !job}
                aria-label={translate('samwoo.schedules.runNow', 'Run now')}
                onClick={() => void runAction('run')}
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
            variant={job?.enabled ? 'secondary' : 'outline'}
            disabled={pending || !job}
            aria-pressed={job?.enabled ?? false}
            onClick={() => void runAction(job?.enabled ? 'pause' : 'resume')}
          >
            {job?.enabled
              ? translate('samwoo.schedules.on', 'On')
              : translate('samwoo.schedules.off', 'Off')}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={pending}
                aria-label={translate('samwoo.schedules.remove', 'Delete schedule')}
                onClick={() => void runAction('delete')}
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
