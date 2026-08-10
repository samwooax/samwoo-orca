import {
  evaluateSamwooSchedule,
  type SamwooSchedule,
  type SamwooScheduleRun
} from '../../../shared/samwoo-schedule'
import { SAMWOO_HERMES_SSH_HOST } from '../../../shared/samwoo-service-endpoints'
import { getSamwooAuth } from './samwoo-auth-store'
import { readSamwooSchedulesSnapshot, useSamwooScheduleStore } from './samwoo-schedule-store'
import { resolveTeamChatModel } from '../../../shared/hermes-team-chat-models'

/** Why 30s: the schedule granularity is one minute, and a 30s tick guarantees a
 *  minute boundary is never missed without polling the store aggressively. */
const TICK_MS = 30_000
const DEFAULT_MODEL_ID = 'gpt-5.6-terra'
const DEFAULT_EFFORT = 'medium'

export type ScheduleSendResult = {
  ok: boolean
  reply?: string
  error?: string
  reason?: 'signed-out' | 'already-running'
}

export type ScheduleRunnerDeps = {
  now: () => number
  getProfile: () => string | null
  getMailToken: () => string | null
  send: (args: {
    schedule: SamwooSchedule
    profile: string
    mailToken: string | null
    occurrenceAt: number
  }) => Promise<ScheduleSendResult>
  recordRun: (run: SamwooScheduleRun) => void
  listSchedules: () => SamwooSchedule[]
  lastOccurrenceAt: (scheduleId: string) => number | null
}

/** Schedules already firing this tick. A slow bot turn must not be started twice. */
const inFlight = new Set<string>()

function requestIdFor(schedule: SamwooSchedule, occurrenceAt: number): string {
  // Why derived and not random: the id doubles as the dedupe key for a retry of
  // the same occurrence, and the server only accepts [A-Za-z0-9._-].
  return `${schedule.id}.${occurrenceAt}`
}

export async function runDueSamwooSchedules(deps: ScheduleRunnerDeps): Promise<void> {
  const nowMs = deps.now()
  const profile = deps.getProfile()
  const mailToken = deps.getMailToken()
  for (const schedule of deps.listSchedules()) {
    if (inFlight.has(schedule.id)) {
      continue
    }
    const { verdict, occurrenceAt } = evaluateSamwooSchedule({
      schedule,
      lastOccurrenceAt: deps.lastOccurrenceAt(schedule.id),
      nowMs
    })
    if (verdict === 'idle' || occurrenceAt === null) {
      continue
    }
    if (verdict === 'stale') {
      // Settle the occurrence so a long-closed app does not replay a backlog,
      // but leave a visible record rather than dropping it silently.
      deps.recordRun({
        scheduleId: schedule.id,
        occurrenceAt,
        finishedAt: nowMs,
        status: 'skipped',
        detail: 'app-was-closed'
      })
      continue
    }
    if (!profile) {
      deps.recordRun({
        scheduleId: schedule.id,
        occurrenceAt,
        finishedAt: nowMs,
        status: 'error',
        detail: 'signed-out'
      })
      continue
    }
    inFlight.add(schedule.id)
    try {
      const result = await deps.send({ schedule, profile, mailToken, occurrenceAt })
      deps.recordRun({
        scheduleId: schedule.id,
        occurrenceAt,
        finishedAt: deps.now(),
        status: result.ok ? 'ok' : 'error',
        detail: result.ok ? '' : (result.error ?? 'failed').slice(0, 500)
      })
    } catch (error) {
      deps.recordRun({
        scheduleId: schedule.id,
        occurrenceAt,
        finishedAt: deps.now(),
        status: 'error',
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 500)
      })
    } finally {
      inFlight.delete(schedule.id)
    }
  }
}

function sendThroughTeamChat(args: {
  schedule: SamwooSchedule
  profile: string
  mailToken: string | null
  occurrenceAt: number
}): Promise<ScheduleSendResult> {
  const requestId = requestIdFor(args.schedule, args.occurrenceAt)
  return window.api.preflight.sendHermesTeamChat({
    requestId,
    // Why a fresh conversation per occurrence: a scheduled turn must not inherit
    // whatever the employee was chatting about, and must not pollute it either.
    conversationId: requestId,
    profile: args.profile,
    host: SAMWOO_HERMES_SSH_HOST,
    ...(args.mailToken ? { mailtoken: args.mailToken } : {}),
    model: resolveTeamChatModel(DEFAULT_MODEL_ID).id,
    effort: DEFAULT_EFFORT,
    message: args.schedule.prompt,
    history: [],
    attachments: []
  })
}

export function createDefaultScheduleRunnerDeps(): ScheduleRunnerDeps {
  return {
    now: () => Date.now(),
    getProfile: () => getSamwooAuth()?.role?.trim() || null,
    getMailToken: () => getSamwooAuth()?.token?.trim() || null,
    listSchedules: () => readSamwooSchedulesSnapshot().schedules,
    lastOccurrenceAt: (scheduleId) =>
      readSamwooSchedulesSnapshot().runs[scheduleId]?.occurrenceAt ?? null,
    recordRun: (run) => useSamwooScheduleStore.getState().recordRun(run),
    send: ({ schedule, profile, mailToken, occurrenceAt }) =>
      sendThroughTeamChat({
        schedule,
        profile,
        mailToken,
        occurrenceAt
      })
  }
}

/** Fire a schedule immediately, outside its timetable. Used by the panel's
 *  "run now" action so the employee can verify a prompt without waiting. */
export async function runSamwooScheduleNow(
  schedule: SamwooSchedule,
  deps: ScheduleRunnerDeps = createDefaultScheduleRunnerDeps()
): Promise<ScheduleSendResult> {
  const nowMs = deps.now()
  const profile = deps.getProfile()
  const mailToken = deps.getMailToken()
  if (!profile) {
    return { ok: false, reason: 'signed-out' }
  }
  if (inFlight.has(schedule.id)) {
    return { ok: false, reason: 'already-running' }
  }
  const evaluation = evaluateSamwooSchedule({
    schedule,
    lastOccurrenceAt: deps.lastOccurrenceAt(schedule.id),
    nowMs
  })
  // Why: running an already-due item manually must settle that occurrence or
  // the next timer tick would send the same instruction again. Otherwise a
  // manual run needs its own id instead of reusing a completed occurrence.
  const occurrenceAt = evaluation.verdict === 'idle' ? nowMs : (evaluation.occurrenceAt ?? nowMs)
  inFlight.add(schedule.id)
  try {
    const result = await deps.send({ schedule, profile, mailToken, occurrenceAt })
    deps.recordRun({
      scheduleId: schedule.id,
      occurrenceAt,
      finishedAt: deps.now(),
      status: result.ok ? 'ok' : 'error',
      detail: result.ok ? '' : (result.error ?? 'failed').slice(0, 500)
    })
    return result
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    deps.recordRun({
      scheduleId: schedule.id,
      occurrenceAt,
      finishedAt: deps.now(),
      status: 'error',
      detail
    })
    return { ok: false, error: detail }
  } finally {
    inFlight.delete(schedule.id)
  }
}

export function startSamwooScheduleRunner(
  deps: ScheduleRunnerDeps = createDefaultScheduleRunnerDeps()
): () => void {
  let stopped = false
  const tick = (): void => {
    if (!stopped) {
      void runDueSamwooSchedules(deps)
    }
  }
  tick()
  const timer = window.setInterval(tick, TICK_MS)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}
