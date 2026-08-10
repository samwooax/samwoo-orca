import { create } from 'zustand'
import {
  isSamwooSchedule,
  isSamwooScheduleRun,
  normalizeScheduleDays,
  SAMWOO_SCHEDULE_MAX_COUNT,
  SAMWOO_SCHEDULE_PROMPT_MAX_CHARS,
  type SamwooSchedule,
  type SamwooScheduleFrequency,
  type SamwooScheduleRun
} from '../../../shared/samwoo-schedule'

/** SAMWOO-ORCA: schedules live in localStorage next to the auth session because
 *  they are per-employee, per-machine and only meaningful while this app runs.
 *  No prompt text leaves the machine until the schedule actually fires. */
const STORAGE_KEY = 'samwoo.schedules.v1'

type PersistedState = {
  schedules: SamwooSchedule[]
  /** Last run per schedule id. Only the most recent one is kept. */
  runs: Record<string, SamwooScheduleRun>
}

type SamwooScheduleState = PersistedState & {
  addSchedule: (input: {
    prompt: string
    time: string
    days: number[]
    frequency: SamwooScheduleFrequency
    interval: number
  }) => SamwooSchedule | null
  updateSchedule: (
    id: string,
    patch: Partial<Pick<SamwooSchedule, 'enabled' | 'remoteJobId'>>
  ) => void
  removeSchedule: (id: string) => void
  recordRun: (run: SamwooScheduleRun) => void
}

const EMPTY: PersistedState = { schedules: [], runs: {} }

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return EMPTY
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    const schedules = Array.isArray(parsed.schedules)
      ? parsed.schedules
          .filter(isSamwooSchedule)
          .slice(0, SAMWOO_SCHEDULE_MAX_COUNT)
          .map((schedule) => ({
            ...schedule,
            frequency: schedule.frequency ?? 'daily',
            interval: schedule.interval ?? 1,
            remoteJobId: schedule.remoteJobId ?? null
          }))
      : []
    const runs: Record<string, SamwooScheduleRun> = {}
    const known = new Set(schedules.map((schedule) => schedule.id))
    for (const [id, run] of Object.entries(parsed.runs ?? {})) {
      // Drop run history for schedules the user already deleted.
      if (known.has(id) && isSamwooScheduleRun(run) && run.scheduleId === id) {
        runs[id] = run
      }
    }
    return { schedules, runs }
  } catch {
    return EMPTY
  }
}

function persist(state: PersistedState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schedules: state.schedules, runs: state.runs })
    )
  } catch {
    // best-effort persistence; an unwritable store must not break the panel
  }
}

function newScheduleId(): string {
  return `sch_${crypto.randomUUID()}`
}

export const useSamwooScheduleStore = create<SamwooScheduleState>((set, get) => ({
  ...load(),
  addSchedule: ({ prompt, time, days, frequency, interval }) => {
    const trimmed = prompt.trim().slice(0, SAMWOO_SCHEDULE_PROMPT_MAX_CHARS)
    const schedule: SamwooSchedule = {
      id: newScheduleId(),
      prompt: trimmed,
      time: time.trim(),
      days: normalizeScheduleDays(days),
      frequency,
      interval,
      remoteJobId: null,
      enabled: true,
      createdAt: Date.now()
    }
    if (!isSamwooSchedule(schedule) || get().schedules.length >= SAMWOO_SCHEDULE_MAX_COUNT) {
      return null
    }
    set((state) => {
      const next = { ...state, schedules: [...state.schedules, schedule] }
      persist(next)
      return { schedules: next.schedules }
    })
    return schedule
  },
  updateSchedule: (id, patch) => {
    set((state) => {
      const schedules = state.schedules.map((schedule) =>
        schedule.id === id ? { ...schedule, ...patch } : schedule
      )
      persist({ ...state, schedules })
      return { schedules }
    })
  },
  removeSchedule: (id) => {
    set((state) => {
      const schedules = state.schedules.filter((schedule) => schedule.id !== id)
      const runs = { ...state.runs }
      delete runs[id]
      persist({ ...state, schedules, runs })
      return { schedules, runs }
    })
  },
  recordRun: (run) => {
    set((state) => {
      const runs = { ...state.runs, [run.scheduleId]: run }
      persist({ ...state, runs })
      return { runs }
    })
  }
}))

export function readSamwooSchedulesSnapshot(): PersistedState {
  const { schedules, runs } = useSamwooScheduleStore.getState()
  return { schedules, runs }
}
