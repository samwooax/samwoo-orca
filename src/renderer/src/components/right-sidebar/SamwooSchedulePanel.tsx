import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
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
import { translate } from '@/i18n/i18n'
import { useSamwooAuthStore } from '@/lib/samwoo-auth-store'
import { useSamwooScheduleStore } from '@/lib/samwoo-schedule-store'
import { useActiveWorktree } from '@/store/selectors'
import { getFileExplorerOperationOwner } from './file-explorer-operation-owner'
import {
  isValidScheduleInterval,
  nextOccurrenceAt,
  SAMWOO_SCHEDULE_MAX_COUNT,
  SAMWOO_SCHEDULE_PROMPT_MAX_CHARS,
  type SamwooScheduleFrequency
} from '../../../../shared/samwoo-schedule'
import { SamwooScheduleDayPicker } from './samwoo-schedule-day-picker'
import { SamwooScheduleRow } from './SamwooScheduleRow'

export default function SamwooSchedulePanel(): React.JSX.Element {
  const auth = useSamwooAuthStore((state) => state.auth)
  const activeWorktree = useActiveWorktree()
  const schedules = useSamwooScheduleStore((state) => state.schedules)
  const runs = useSamwooScheduleStore((state) => state.runs)
  const addSchedule = useSamwooScheduleStore((state) => state.addSchedule)
  const updateSchedule = useSamwooScheduleStore((state) => state.updateSchedule)
  const [prompt, setPrompt] = useState('')
  const [frequency, setFrequency] = useState<SamwooScheduleFrequency>('daily')
  const [interval, setIntervalValue] = useState(5)
  const [time, setTime] = useState('08:00')
  const [days, setDays] = useState<number[]>([])
  const [migrating, setMigrating] = useState(false)
  const remoteJobsInFlight = useRef(new Set<string>())
  const profile = auth?.role?.trim() || null
  const projectOwner = activeWorktree
    ? getFileExplorerOperationOwner(activeWorktree.id)
    : { kind: 'unresolved' as const }
  const localProject = projectOwner.kind === 'local' ? activeWorktree : null

  useEffect(() => {
    if (!localProject) {
      return
    }
    for (const schedule of schedules) {
      if (!schedule.worktreeId || !schedule.worktreePath) {
        updateSchedule(schedule.id, {
          worktreeId: localProject.id,
          worktreePath: localProject.path
        })
      }
    }
  }, [localProject, schedules, updateSchedule])

  useEffect(() => {
    if (!profile) {
      return
    }
    const remoteSchedules = schedules.filter(
      (schedule) => schedule.remoteJobId && !remoteJobsInFlight.current.has(schedule.remoteJobId)
    )
    if (remoteSchedules.length === 0) {
      return
    }
    let cancelled = false
    setMigrating(true)
    for (const schedule of remoteSchedules) {
      remoteJobsInFlight.current.add(schedule.remoteJobId!)
    }
    void Promise.all(
      remoteSchedules.map(async (schedule) => {
        const jobId = schedule.remoteJobId!
        try {
          const result = await window.api.preflight.samwooHermesCron.action({
            profile,
            jobId,
            action: 'delete'
          })
          if (!cancelled && result.ok) {
            updateSchedule(schedule.id, { remoteJobId: null })
          }
          return result.ok
        } catch {
          return false
        } finally {
          remoteJobsInFlight.current.delete(jobId)
        }
      })
    ).then((results) => {
      if (cancelled) {
        return
      }
      setMigrating(false)
      if (results.some((ok) => !ok)) {
        toast.error(
          translate(
            'samwoo.schedules.migrationFailed',
            'Some old server schedules could not be disabled. Try again while connected.'
          )
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [profile, schedules, updateSchedule])

  const atCapacity = schedules.length >= SAMWOO_SCHEDULE_MAX_COUNT
  const effectiveInterval = frequency === 'daily' ? 1 : interval
  const canSubmit =
    prompt.trim().length > 0 &&
    !atCapacity &&
    isValidScheduleInterval(frequency, effectiveInterval) &&
    Boolean(profile && localProject)

  const sorted = useMemo(() => {
    const now = Date.now()
    return [...schedules].sort(
      (a, b) =>
        (nextOccurrenceAt(a, now) ?? Number.MAX_SAFE_INTEGER) -
          (nextOccurrenceAt(b, now) ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt
    )
  }, [schedules])

  const handleAdd = useCallback(() => {
    if (!localProject) {
      toast.error(
        translate('samwoo.schedules.localProjectRequired', 'Select a local project first.')
      )
      return
    }
    const schedule = addSchedule({
      prompt,
      time,
      days,
      frequency,
      interval: effectiveInterval,
      worktreeId: localProject.id,
      worktreePath: localProject.path
    })
    if (!schedule) {
      toast.error(translate('samwoo.schedules.addFailed', 'Check the schedule and try again.'))
      return
    }
    setPrompt('')
    toast.success(
      translate(
        'samwoo.schedules.localRegistered',
        'Saved on this PC. Results will be written to the connected project.'
      )
    )
  }, [addSchedule, days, effectiveInterval, frequency, localProject, prompt, time])

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
          {migrating ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {translate(
            'samwoo.schedules.localNotice',
            'Runs only while Orca is open. Results are saved under SAMWOO-예약결과 in this project.'
          )}
        </p>
        {!localProject ? (
          <p className="mt-1 text-[11px] text-destructive">
            {translate('samwoo.schedules.localProjectRequired', 'Select a local project first.')}
          </p>
        ) : null}
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
        </div>
      ) : (
        <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
          {sorted.map((schedule) => (
            <SamwooScheduleRow key={schedule.id} schedule={schedule} run={runs[schedule.id]} />
          ))}
        </div>
      )}
    </div>
  )
}
