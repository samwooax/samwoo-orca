// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'samwoo.schedules.v1'

const VALID = {
  id: 'sch_a',
  prompt: 'summarize mail',
  time: '08:00',
  days: [1, 2],
  enabled: true,
  createdAt: 1_770_000_000_000
}

describe('SAMWOO schedule store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('drops malformed persisted schedules instead of loading them', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schedules: [VALID, { ...VALID, id: 'sch_b', time: '25:00' }, { nope: true }],
        runs: {}
      })
    )
    const { useSamwooScheduleStore } = await import('./samwoo-schedule-store')
    expect(useSamwooScheduleStore.getState().schedules.map((s) => s.id)).toEqual(['sch_a'])
  })

  it('discards run history that belongs to a deleted schedule', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schedules: [VALID],
        runs: {
          sch_a: { scheduleId: 'sch_a', occurrenceAt: 1, finishedAt: 2, status: 'ok', detail: '' },
          sch_gone: {
            scheduleId: 'sch_gone',
            occurrenceAt: 1,
            finishedAt: 2,
            status: 'ok',
            detail: ''
          }
        }
      })
    )
    const { useSamwooScheduleStore } = await import('./samwoo-schedule-store')
    expect(Object.keys(useSamwooScheduleStore.getState().runs)).toEqual(['sch_a'])
  })

  it('discards malformed or mismatched persisted run records', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schedules: [VALID],
        runs: {
          sch_a: {
            scheduleId: 'sch_other',
            occurrenceAt: 'not-a-number',
            finishedAt: 2,
            status: 'unknown',
            detail: null
          }
        }
      })
    )
    const { useSamwooScheduleStore } = await import('./samwoo-schedule-store')
    expect(useSamwooScheduleStore.getState().runs).toEqual({})
  })

  it('rejects a blank prompt and an invalid time', async () => {
    const { useSamwooScheduleStore } = await import('./samwoo-schedule-store')
    const store = useSamwooScheduleStore.getState()
    expect(
      store.addSchedule({
        prompt: '   ',
        time: '08:00',
        days: [],
        frequency: 'daily',
        interval: 1
      })
    ).toBeNull()
    expect(
      store.addSchedule({
        prompt: 'ok',
        time: '8:00',
        days: [],
        frequency: 'daily',
        interval: 1
      })
    ).toBeNull()
    expect(useSamwooScheduleStore.getState().schedules).toEqual([])
  })

  it('persists an added schedule and removes it with its run record', async () => {
    const { useSamwooScheduleStore } = await import('./samwoo-schedule-store')
    const created = useSamwooScheduleStore.getState().addSchedule({
      prompt: 'daily report',
      time: '09:30',
      days: [0, 1, 2, 3, 4, 5, 6],
      frequency: 'daily',
      interval: 1
    })
    expect(created).not.toBeNull()
    // All seven days collapse to the every-day form.
    expect(created?.days).toEqual([])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').schedules).toHaveLength(1)

    useSamwooScheduleStore.getState().recordRun({
      scheduleId: created!.id,
      occurrenceAt: 10,
      finishedAt: 11,
      status: 'ok',
      detail: ''
    })
    expect(useSamwooScheduleStore.getState().runs[created!.id]).toBeDefined()

    useSamwooScheduleStore.getState().removeSchedule(created!.id)
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(persisted.schedules).toEqual([])
    expect(persisted.runs).toEqual({})
  })

  it('stops accepting schedules at the cap', async () => {
    const { useSamwooScheduleStore } = await import('./samwoo-schedule-store')
    const { SAMWOO_SCHEDULE_MAX_COUNT } = await import('../../../shared/samwoo-schedule')
    for (let index = 0; index < SAMWOO_SCHEDULE_MAX_COUNT; index += 1) {
      expect(
        useSamwooScheduleStore.getState().addSchedule({
          prompt: `job ${index}`,
          time: '08:00',
          days: [],
          frequency: 'daily',
          interval: 1
        })
      ).not.toBeNull()
    }
    expect(
      useSamwooScheduleStore.getState().addSchedule({
        prompt: 'one too many',
        time: '08:00',
        days: [],
        frequency: 'daily',
        interval: 1
      })
    ).toBeNull()
    expect(useSamwooScheduleStore.getState().schedules).toHaveLength(SAMWOO_SCHEDULE_MAX_COUNT)
  })
})
