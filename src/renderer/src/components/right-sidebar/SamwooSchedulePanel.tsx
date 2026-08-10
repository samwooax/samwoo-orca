import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooScheduleStore } from '@/lib/samwoo-schedule-store'
import type { SamwooHermesCronJob } from '../../../../shared/samwoo-hermes-cron'
import {
  isValidScheduleInterval,
  SAMWOO_SCHEDULE_MAX_COUNT,
  SAMWOO_SCHEDULE_PROMPT_MAX_CHARS,
  type SamwooSchedule,
  type SamwooScheduleFrequency
} from '../../../../shared/samwoo-schedule'
import { SamwooScheduleDayPicker } from './samwoo-schedule-day-picker'
import { SamwooScheduleRow } from './SamwooScheduleRow'

function matchingJob(schedule: SamwooSchedule, jobs: SamwooHermesCronJob[]) {
  const expectedName = `SAMWOO-ORCA:${schedule.id}`
  return jobs.find((job) => job.id === schedule.remoteJobId || job.name === expectedName)
}

export default function SamwooSchedulePanel(): React.JSX.Element {
  const auth = useSamwooAuthStore((state) => state.auth)
  const schedules = useSamwooScheduleStore((state) => state.schedules)
  const addSchedule = useSamwooScheduleStore((state) => state.addSchedule)
  const updateSchedule = useSamwooScheduleStore((state) => state.updateSchedule)
  const [prompt, setPrompt] = useState('')
  const [frequency, setFrequency] = useState<SamwooScheduleFrequency>('daily')
  const [interval, setIntervalValue] = useState(5)
  const [time, setTime] = useState('08:00')
  const [days, setDays] = useState<number[]>([])
  const [jobs, setJobs] = useState<SamwooHermesCronJob[]>([])
  const [schedulerHealthy, setSchedulerHealthy] = useState(false)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const migratedProfileRef = useRef<string | null>(null)
  const profile = auth?.role?.trim() || null

  const refresh = useCallback(async () => {
    if (!profile) {
      return
    }
    setBusy(true)
    const listed = await window.api.preflight.samwooHermesCron.list(profile)
    setChecked(true)
    setSchedulerHealthy(listed.schedulerHealthy)
    if (!listed.ok) {
      setBusy(false)
      toast.error(
        listed.error ?? translate('samwoo.schedules.refreshFailed', 'Cron status failed.')
      )
      return
    }
    let currentJobs = listed.jobs
    for (const schedule of schedules) {
      const existing = matchingJob(schedule, currentJobs)
      if (existing) {
        if (schedule.remoteJobId !== existing.id || schedule.enabled !== existing.enabled) {
          updateSchedule(schedule.id, {
            remoteJobId: existing.id,
            enabled: existing.enabled
          })
        }
        continue
      }
      const registered = await window.api.preflight.samwooHermesCron.upsert({
        profile,
        schedule
      })
      setSchedulerHealthy(registered.schedulerHealthy)
      if (registered.ok && registered.job) {
        currentJobs = [...currentJobs, registered.job]
        updateSchedule(schedule.id, {
          remoteJobId: registered.job.id,
          enabled: registered.job.enabled
        })
      }
    }
    setJobs(currentJobs)
    setBusy(false)
  }, [profile, schedules, updateSchedule])

  useEffect(() => {
    if (!profile || migratedProfileRef.current === profile) {
      return
    }
    migratedProfileRef.current = profile
    void refresh()
  }, [profile, refresh])

  const atCapacity = schedules.length >= SAMWOO_SCHEDULE_MAX_COUNT
  const effectiveInterval = frequency === 'daily' ? 1 : interval
  const canSubmit =
    prompt.trim().length > 0 &&
    !atCapacity &&
    isValidScheduleInterval(frequency, effectiveInterval) &&
    Boolean(profile)

  const sorted = useMemo(
    () =>
      [...schedules].sort(
        (a, b) =>
          (matchingJob(a, jobs)?.nextRunAt ?? '').localeCompare(
            matchingJob(b, jobs)?.nextRunAt ?? ''
          ) || a.createdAt - b.createdAt
      ),
    [jobs, schedules]
  )

  const handleAdd = useCallback(async () => {
    if (!profile) {
      return
    }
    const schedule = addSchedule({
      prompt,
      time,
      days,
      frequency,
      interval: effectiveInterval
    })
    if (!schedule) {
      toast.error(translate('samwoo.schedules.addFailed', 'Check the schedule and try again.'))
      return
    }
    setBusy(true)
    const result = await window.api.preflight.samwooHermesCron.upsert({ profile, schedule })
    setBusy(false)
    setSchedulerHealthy(result.schedulerHealthy)
    if (!result.ok || !result.job) {
      toast.error(
        result.error ??
          translate('samwoo.schedules.registrationFailed', 'Cron registration failed.')
      )
      return
    }
    const registeredJob = result.job
    updateSchedule(schedule.id, { remoteJobId: registeredJob.id, enabled: registeredJob.enabled })
    setJobs((current) => [...current.filter((job) => job.id !== registeredJob.id), registeredJob])
    setPrompt('')
    toast.success(
      translate('samwoo.schedules.registered', 'Hermes cron registered · Job {{id}}', {
        id: result.job.id
      })
    )
  }, [addSchedule, days, effectiveInterval, frequency, profile, prompt, time, updateSchedule])

  if (!profile) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {translate('samwoo.schedules.signedOut', 'Sign in to SAMWOO to use schedules.')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
            {translate('samwoo.schedules.title', 'Scheduled prompts')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={busy}
                aria-label={translate('samwoo.schedules.refresh', 'Refresh cron status')}
                onClick={() => void refresh()}
              >
                <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {translate('samwoo.schedules.refresh', 'Refresh cron status')}
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {translate(
            'samwoo.schedules.serverNotice',
            'Registered on the connected Hermes profile and runs even when this app is closed.'
          )}
        </p>
        <div
          className={
            schedulerHealthy
              ? 'mt-1 text-[11px] text-muted-foreground'
              : 'mt-1 text-[11px] text-destructive'
          }
        >
          {checked
            ? schedulerHealthy
              ? translate('samwoo.schedules.schedulerOnline', 'Hermes cron scheduler is running')
              : translate(
                  'samwoo.schedules.schedulerOffline',
                  'Hermes cron scheduler is not responding'
                )
            : translate('samwoo.schedules.schedulerChecking', 'Checking Hermes cron scheduler…')}
        </div>
      </div>

      <div className="border-b border-border px-3 py-2">
        <Textarea
          value={prompt}
          maxLength={SAMWOO_SCHEDULE_PROMPT_MAX_CHARS}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder={translate(
            'samwoo.schedules.promptPlaceholder',
            'Enter the task for the team bot.'
          )}
          className="text-xs"
        />
        <div className="mt-2 flex items-center gap-2">
          <Select
            value={frequency}
            onValueChange={(value) => setFrequency(value as SamwooScheduleFrequency)}
          >
            <SelectTrigger className="h-7 w-[7.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">
                {translate('samwoo.schedules.minutes', 'Minutes')}
              </SelectItem>
              <SelectItem value="hours">{translate('samwoo.schedules.hours', 'Hours')}</SelectItem>
              <SelectItem value="daily">{translate('samwoo.schedules.daily', 'Daily')}</SelectItem>
            </SelectContent>
          </Select>
          {frequency === 'daily' ? (
            <>
              <Input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="h-7 w-[7rem] text-xs"
              />
              <SamwooScheduleDayPicker days={days} onChange={setDays} />
            </>
          ) : (
            <Input
              type="number"
              min={frequency === 'minutes' ? 5 : 1}
              max={frequency === 'minutes' ? 59 : 24}
              value={interval}
              onChange={(event) => setIntervalValue(Number(event.target.value))}
              className="h-7 w-20 text-xs"
              aria-label={translate('samwoo.schedules.interval', 'Interval')}
            />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {atCapacity
              ? translate('samwoo.schedules.atCapacity', 'Limit of {{count}} reached', {
                  count: SAMWOO_SCHEDULE_MAX_COUNT
                })
              : ''}
          </span>
          <Button size="xs" disabled={!canSubmit || busy} onClick={() => void handleAdd()}>
            {busy ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
            {translate('samwoo.schedules.add', 'Add schedule')}
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="text-sm font-medium text-foreground">
            {translate('samwoo.schedules.emptyTitle', 'No schedules yet')}
          </div>
        </div>
      ) : (
        <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
          {sorted.map((schedule) => (
            <SamwooScheduleRow
              key={schedule.id}
              schedule={schedule}
              job={matchingJob(schedule, jobs)}
              profile={profile}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}
