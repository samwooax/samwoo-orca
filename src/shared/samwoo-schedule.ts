/** SAMWOO-ORCA: in-app scheduled team-bot prompts.
 *
 *  Why in-app and not a server cron: the bot reaches this employee's mail and
 *  messages with the opaque session token the desktop app holds, and that token
 *  only exists while the app is signed in. Running the schedule inside the app
 *  keeps the existing token lifetime and needs no long-lived delegated
 *  credential on the VPS. The trade-off is explicit: a schedule whose time
 *  passes while the app is closed does not fire then — it is caught up on the
 *  next launch inside CATCH_UP_WINDOW_MS, and skipped (not silently dropped)
 *  when it is older than that. */

export const SAMWOO_SCHEDULE_PROMPT_MAX_CHARS = 2_000
export const SAMWOO_SCHEDULE_MAX_COUNT = 20

/** Why 12h: an overnight schedule should still run when the laptop opens in the
 *  morning, but a week-old occurrence firing on launch would surprise the user. */
export const SAMWOO_SCHEDULE_CATCH_UP_WINDOW_MS = 12 * 60 * 60 * 1000

export type SamwooSchedule = {
  id: string
  /** Natural-language instruction handed to the team bot verbatim. */
  prompt: string
  /** Local wall-clock time, `HH:MM` on a 24-hour clock. */
  time: string
  /** Local weekdays (0=Sunday … 6=Saturday). Empty means every day. */
  days: number[]
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
}

export type SamwooScheduleVerdict = 'idle' | 'due' | 'stale'

export type SamwooScheduleEvaluation = {
  verdict: SamwooScheduleVerdict
  /** The occurrence the verdict refers to; null when nothing has come due yet. */
  occurrenceAt: number | null
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

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
    typeof candidate.detail === 'string'
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
