import { describe, expect, it } from 'vitest'
import {
  evaluateSamwooSchedule,
  isSamwooSchedule,
  nextOccurrenceAt,
  normalizeScheduleDays,
  parseScheduleTime,
  previousOccurrenceAt,
  SAMWOO_SCHEDULE_CATCH_UP_WINDOW_MS,
  SAMWOO_SCHEDULE_PROMPT_MAX_CHARS,
  type SamwooSchedule
} from './samwoo-schedule'

// 2026-08-10 is a Monday in local time.
const MONDAY_0800 = new Date(2026, 7, 10, 8, 0, 0, 0).getTime()
const MONDAY_0900 = new Date(2026, 7, 10, 9, 0, 0, 0).getTime()
const SUNDAY_0900 = new Date(2026, 7, 9, 9, 0, 0, 0).getTime()

function schedule(overrides: Partial<SamwooSchedule> = {}): SamwooSchedule {
  return {
    id: 'sch_test',
    prompt: 'summarize mail',
    time: '08:00',
    days: [],
    enabled: true,
    createdAt: new Date(2026, 7, 1).getTime(),
    ...overrides
  }
}

describe('parseScheduleTime', () => {
  it('accepts 24-hour times and rejects malformed ones', () => {
    expect(parseScheduleTime('08:00')).toEqual({ hour: 8, minute: 0 })
    expect(parseScheduleTime(' 23:59 ')).toEqual({ hour: 23, minute: 59 })
    expect(parseScheduleTime('24:00')).toBeNull()
    expect(parseScheduleTime('8:00')).toBeNull()
    expect(parseScheduleTime('08:60')).toBeNull()
    expect(parseScheduleTime('')).toBeNull()
  })
})

describe('normalizeScheduleDays', () => {
  it('sorts, dedupes and drops out-of-range days', () => {
    expect(normalizeScheduleDays([3, 1, 1, 9, -2])).toEqual([1, 3])
  })

  it('collapses all seven days to the every-day form', () => {
    expect(normalizeScheduleDays([0, 1, 2, 3, 4, 5, 6])).toEqual([])
  })
})

describe('isSamwooSchedule', () => {
  it('rejects an empty prompt and an invalid time', () => {
    expect(isSamwooSchedule(schedule())).toBe(true)
    expect(isSamwooSchedule(schedule({ prompt: '   ' }))).toBe(false)
    expect(isSamwooSchedule(schedule({ time: '7:5' }))).toBe(false)
    expect(isSamwooSchedule(null)).toBe(false)
  })

  it('rejects persisted prompts beyond the product limit', () => {
    expect(
      isSamwooSchedule(schedule({ prompt: 'x'.repeat(SAMWOO_SCHEDULE_PROMPT_MAX_CHARS + 1) }))
    ).toBe(false)
  })
})

describe('occurrence maths', () => {
  it('finds the previous and next daily occurrence', () => {
    expect(previousOccurrenceAt(schedule(), MONDAY_0900)).toBe(MONDAY_0800)
    expect(nextOccurrenceAt(schedule(), MONDAY_0900)).toBe(
      new Date(2026, 7, 11, 8, 0, 0, 0).getTime()
    )
  })

  it('treats an exact hit as already occurred, not upcoming', () => {
    expect(previousOccurrenceAt(schedule(), MONDAY_0800)).toBe(MONDAY_0800)
    expect(nextOccurrenceAt(schedule(), MONDAY_0800)).toBe(
      new Date(2026, 7, 11, 8, 0, 0, 0).getTime()
    )
  })

  it('skips weekdays that are not selected', () => {
    // Monday-only schedule, evaluated on Sunday.
    const mondayOnly = schedule({ days: [1] })
    expect(nextOccurrenceAt(mondayOnly, SUNDAY_0900)).toBe(MONDAY_0800)
    expect(previousOccurrenceAt(mondayOnly, SUNDAY_0900)).toBe(
      new Date(2026, 7, 3, 8, 0, 0, 0).getTime()
    )
  })

  it('returns null for an unparseable time', () => {
    expect(nextOccurrenceAt(schedule({ time: 'nope' }), MONDAY_0900)).toBeNull()
    expect(previousOccurrenceAt(schedule({ time: 'nope' }), MONDAY_0900)).toBeNull()
  })
})

describe('evaluateSamwooSchedule', () => {
  it('is due when the occurrence has not been run yet', () => {
    expect(
      evaluateSamwooSchedule({ schedule: schedule(), lastOccurrenceAt: null, nowMs: MONDAY_0900 })
    ).toEqual({ verdict: 'due', occurrenceAt: MONDAY_0800 })
  })

  it('is idle once that occurrence is recorded', () => {
    expect(
      evaluateSamwooSchedule({
        schedule: schedule(),
        lastOccurrenceAt: MONDAY_0800,
        nowMs: MONDAY_0900
      })
    ).toEqual({ verdict: 'idle', occurrenceAt: MONDAY_0800 })
  })

  it('is idle while disabled', () => {
    expect(
      evaluateSamwooSchedule({
        schedule: schedule({ enabled: false }),
        lastOccurrenceAt: null,
        nowMs: MONDAY_0900
      })
    ).toEqual({ verdict: 'idle', occurrenceAt: null })
  })

  it('never owes occurrences from before the schedule existed', () => {
    const created = schedule({ createdAt: MONDAY_0900 })
    expect(
      evaluateSamwooSchedule({ schedule: created, lastOccurrenceAt: null, nowMs: MONDAY_0900 })
    ).toEqual({ verdict: 'idle', occurrenceAt: MONDAY_0800 })
  })

  it('catches up inside the window and goes stale outside it', () => {
    const justInside = MONDAY_0800 + SAMWOO_SCHEDULE_CATCH_UP_WINDOW_MS
    expect(
      evaluateSamwooSchedule({ schedule: schedule(), lastOccurrenceAt: null, nowMs: justInside })
        .verdict
    ).toBe('due')
    expect(
      evaluateSamwooSchedule({
        schedule: schedule(),
        lastOccurrenceAt: null,
        nowMs: justInside + 1
      }).verdict
    ).toBe('stale')
  })
})
