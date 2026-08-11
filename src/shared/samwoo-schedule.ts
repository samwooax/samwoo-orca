/** SAMWOO-ORCA: in-app scheduled team-bot prompts bound to a local project. */

export const SAMWOO_SCHEDULE_PROMPT_MAX_CHARS = 2_000
export const SAMWOO_SCHEDULE_MAX_COUNT = 20

/** Why 90s: tolerate one delayed 30s timer tick without replaying work missed while Orca was closed. */
export const SAMWOO_SCHEDULE_CATCH_UP_WINDOW_MS = 90_000

export type SamwooScheduleFrequency = 'minutes' | 'hours' | 'daily'

export type SamwooSchedule = {
  id: string
  /** Natural-language instruction handed to the team bot verbatim. */
  prompt: string
  /** Local wall-clock time, `HH:MM` on a 24-hour clock. */
  time: string
  /** Local weekdays (0=Sunday … 6=Saturday). Empty means every day. */
  days: number[]
  /** Missing on v1 schedules; those records migrate as daily schedules. */
  frequency?: SamwooScheduleFrequency
  /** Used by minute/hour schedules. Daily schedules keep this at 1. */
  interval?: number
  /** Verified Hermes cron job id. Missing until a legacy local schedule is migrated. */
  remoteJobId?: string | null
  /** Project selected when the schedule was created. Legacy records may be unbound. */
  worktreeId?: string
  worktreePath?: string
  enabled: boolean
  createdAt: number
}

export type SamwooScheduleRunStatus = 'ok' | 'error' | 'skipped'

export type SamwooScheduleRun = {
  scheduleId: string
  /** The scheduled occurrence this run belongs to, not the wall clock at start. */
  occurrenceAt: number
  finishedAt: number
  status: SamwooScheduleRunStatus
  detail: string
  outputPath?: string
}

export type WriteSamwooScheduleResultArgs = {
  worktreePath: string
  scheduleId: string
  occurrenceAt: number
  profile: string
  prompt: string
  reply: string
}

export type WriteSamwooScheduleResultResult =
  | { ok: true; outputPath: string }
  | { ok: false; error: string }

export type SamwooScheduleVerdict = 'idle' | 'due' | 'stale'

export type SamwooScheduleEvaluation = {
  verdict: SamwooScheduleVerdict
  /** The occurrence the verdict refers to; null when nothing has come due yet. */
  occurrenceAt: number | null
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const REMOTE_JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export function scheduleFrequency(schedule: SamwooSchedule): SamwooScheduleFrequency {
  return schedule.frequency ?? 'daily'
}

export function isValidScheduleInterval(
  frequency: SamwooScheduleFrequency,
  interval: number
): boolean {
  if (!Number.isInteger(interval)) {
    return false
  }
  if (frequency === 'minutes') {
    return interval >= 5 && interval <= 59
  }
  if (frequency === 'hours') {
    return interval >= 1 && interval <= 24
  }
  return interval === 1
}

export function buildHermesCronSchedule(
  schedule: SamwooSchedule,
  timezoneOffsetMinutes = 0
): string | null {
  const frequency = scheduleFrequency(schedule)
  const interval = schedule.interval ?? 1
  if (!isValidScheduleInterval(frequency, interval)) {
    return null
  }
  if (frequency === 'minutes') {
    return `every ${interval}m`
  }
  if (frequency === 'hours') {
    return `every ${interval}h`
  }
  const parsed = parseScheduleTime(schedule.time)
  if (!parsed || !Number.isInteger(timezoneOffsetMinutes)) {
    return null
  }
  const weekdays = normalizeScheduleDays(schedule.days)
  const utcMinutes = parsed.hour * 60 + parsed.minute + timezoneOffsetMinutes
  const dayShift = Math.floor(utcMinutes / (24 * 60))
  const normalizedMinutes = ((utcMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const utcWeekdays = weekdays.map((day) => (day + dayShift + 7) % 7).sort((a, b) => a - b)
  return `${normalizedMinutes % 60} ${Math.floor(normalizedMinutes / 60)} * * ${utcWeekdays.length === 0 ? '*' : utcWeekdays.join(',')}`
}

export function parseScheduleTime(time: string): { hour: number; minute: number } | null {
  const match = TIME_RE.exec(time.trim())
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

export function normalizeScheduleDays(days: readonly number[]): number[] {
  const unique = new Set<number>()
  for (const day of days) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      unique.add(day)
    }
  }
  // Selecting all seven days is the same rule as "every day"; store the simpler
  // form so the two never render differently.
  return unique.size === 7 ? [] : [...unique].sort((a, b) => a - b)
}

export function isSamwooSchedule(value: unknown): value is SamwooSchedule {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<SamwooSchedule>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.prompt === 'string' &&
    candidate.prompt.trim().length > 0 &&
    candidate.prompt.length <= SAMWOO_SCHEDULE_PROMPT_MAX_CHARS &&
    typeof candidate.time === 'string' &&
    parseScheduleTime(candidate.time) !== null &&
    Array.isArray(candidate.days) &&
    candidate.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
    (candidate.frequency === undefined ||
      candidate.frequency === 'minutes' ||
      candidate.frequency === 'hours' ||
      candidate.frequency === 'daily') &&
    (candidate.interval === undefined ||
      isValidScheduleInterval(candidate.frequency ?? 'daily', candidate.interval)) &&
    (candidate.remoteJobId === undefined ||
      candidate.remoteJobId === null ||
      (typeof candidate.remoteJobId === 'string' &&
        REMOTE_JOB_ID_RE.test(candidate.remoteJobId))) &&
    (candidate.worktreeId === undefined ||
      (typeof candidate.worktreeId === 'string' && candidate.worktreeId.length > 0)) &&
    (candidate.worktreePath === undefined ||
      (typeof candidate.worktreePath === 'string' && candidate.worktreePath.trim().length > 0)) &&
    typeof candidate.enabled === 'boolean' &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt)
  )
}

export function isSamwooScheduleRun(value: unknown): value is SamwooScheduleRun {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<SamwooScheduleRun>
  return (
    typeof candidate.scheduleId === 'string' &&
    candidate.scheduleId.length > 0 &&
    typeof candidate.occurrenceAt === 'number' &&
    Number.isFinite(candidate.occurrenceAt) &&
    typeof candidate.finishedAt === 'number' &&
    Number.isFinite(candidate.finishedAt) &&
    (candidate.status === 'ok' || candidate.status === 'error' || candidate.status === 'skipped') &&
    typeof candidate.detail === 'string' &&
    (candidate.outputPath === undefined || typeof candidate.outputPath === 'string')
  )
}

function matchesDay(schedule: Pick<SamwooSchedule, 'days'>, weekday: number): boolean {
  return schedule.days.length === 0 || schedule.days.includes(weekday)
}

function occurrenceOnLocalDay(
  reference: Date,
  dayOffset: number,
  hour: number,
  minute: number
): { at: number; weekday: number } {
  const day = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() + dayOffset,
    hour,
    minute,
    0,
    0
  )
  return { at: day.getTime(), weekday: day.getDay() }
}

/** Latest occurrence at or before `nowMs`, or null when none exists in the last week. */
export function previousOccurrenceAt(schedule: SamwooSchedule, nowMs: number): number | null {
  const frequency = scheduleFrequency(schedule)
  if (frequency !== 'daily') {
    const interval = schedule.interval ?? 1
    if (!isValidScheduleInterval(frequency, interval) || nowMs <= schedule.createdAt) {
      return null
    }
    const intervalMs = interval * (frequency === 'minutes' ? 60_000 : 3_600_000)
    const completedIntervals = Math.floor((nowMs - schedule.createdAt) / intervalMs)
    return completedIntervals > 0 ? schedule.createdAt + completedIntervals * intervalMs : null
  }
  const parsed = parseScheduleTime(schedule.time)
  if (!parsed) {
    return null
  }
  const reference = new Date(nowMs)
  for (let back = 0; back <= 7; back += 1) {
    const { at, weekday } = occurrenceOnLocalDay(reference, -back, parsed.hour, parsed.minute)
    if (at <= nowMs && matchesDay(schedule, weekday)) {
      return at
    }
  }
  return null
}

/** Earliest occurrence strictly after `fromMs`, or null when the time is invalid. */
export function nextOccurrenceAt(schedule: SamwooSchedule, fromMs: number): number | null {
  const frequency = scheduleFrequency(schedule)
  if (frequency !== 'daily') {
    const interval = schedule.interval ?? 1
    if (!isValidScheduleInterval(frequency, interval)) {
      return null
    }
    const intervalMs = interval * (frequency === 'minutes' ? 60_000 : 3_600_000)
    const completedIntervals = Math.floor(Math.max(0, fromMs - schedule.createdAt) / intervalMs)
    return schedule.createdAt + (completedIntervals + 1) * intervalMs
  }
  const parsed = parseScheduleTime(schedule.time)
  if (!parsed) {
    return null
  }
  const reference = new Date(fromMs)
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const { at, weekday } = occurrenceOnLocalDay(reference, ahead, parsed.hour, parsed.minute)
    if (at > fromMs && matchesDay(schedule, weekday)) {
      return at
    }
  }
  return null
}

export function evaluateSamwooSchedule(args: {
  schedule: SamwooSchedule
  /** Occurrence timestamp of the last recorded run, if any. */
  lastOccurrenceAt: number | null
  nowMs: number
  catchUpWindowMs?: number
}): SamwooScheduleEvaluation {
  const { schedule, lastOccurrenceAt, nowMs } = args
  const catchUpWindowMs = args.catchUpWindowMs ?? SAMWOO_SCHEDULE_CATCH_UP_WINDOW_MS
  if (!schedule.enabled) {
    return { verdict: 'idle', occurrenceAt: null }
  }
  const occurrenceAt = previousOccurrenceAt(schedule, nowMs)
  if (occurrenceAt === null) {
    return { verdict: 'idle', occurrenceAt: null }
  }
  // Occurrences before the schedule existed are not retroactively owed.
  const settledAt = lastOccurrenceAt ?? schedule.createdAt
  if (occurrenceAt <= settledAt) {
    return { verdict: 'idle', occurrenceAt }
  }
  return {
    verdict: nowMs - occurrenceAt > catchUpWindowMs ? 'stale' : 'due',
    occurrenceAt
  }
}
