import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  runDueSamwooSchedules,
  runSamwooScheduleNow,
  type ScheduleRunnerDeps
} from './samwoo-schedule-runner'
import type { SamwooSchedule, SamwooScheduleRun } from '../../../shared/samwoo-schedule'
import { SAMWOO_SCHEDULE_CATCH_UP_WINDOW_MS } from '../../../shared/samwoo-schedule'

const MONDAY_0800 = new Date(2026, 7, 10, 8, 0, 0, 0).getTime()
const MONDAY_0900 = new Date(2026, 7, 10, 9, 0, 0, 0).getTime()

function schedule(overrides: Partial<SamwooSchedule> = {}): SamwooSchedule {
  return {
    id: 'sch_a',
    prompt: 'summarize mail',
    time: '08:00',
    days: [],
    enabled: true,
    createdAt: new Date(2026, 7, 1).getTime(),
    ...overrides
  }
}

function makeDeps(overrides: Partial<ScheduleRunnerDeps> = {}): {
  deps: ScheduleRunnerDeps
  runs: SamwooScheduleRun[]
} {
  const runs: SamwooScheduleRun[] = []
  const deps: ScheduleRunnerDeps = {
    now: () => MONDAY_0900,
    getProfile: () => 'ai_center',
    getMailToken: () => 'token-123',
    listSchedules: () => [schedule()],
    lastOccurrenceAt: () => null,
    recordRun: (run) => runs.push(run),
    send: vi.fn(async () => ({ ok: true, reply: 'done' })),
    ...overrides
  }
  return { deps, runs }
}

describe('runDueSamwooSchedules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends a due schedule and records the occurrence it settled', async () => {
    const { deps, runs } = makeDeps()
    await runDueSamwooSchedules(deps)
    expect(deps.send).toHaveBeenCalledTimes(1)
    expect(deps.send).toHaveBeenCalledWith({
      schedule: schedule(),
      profile: 'ai_center',
      mailToken: 'token-123',
      occurrenceAt: MONDAY_0800
    })
    expect(runs).toEqual([
      {
        scheduleId: 'sch_a',
        occurrenceAt: MONDAY_0800,
        finishedAt: MONDAY_0900,
        status: 'ok',
        detail: ''
      }
    ])
  })

  it('does not send again for an occurrence already recorded', async () => {
    const { deps, runs } = makeDeps({ lastOccurrenceAt: () => MONDAY_0800 })
    await runDueSamwooSchedules(deps)
    expect(deps.send).not.toHaveBeenCalled()
    expect(runs).toEqual([])
  })

  it('settles a long-missed occurrence as skipped instead of replaying it', async () => {
    const { deps, runs } = makeDeps({
      now: () => MONDAY_0800 + SAMWOO_SCHEDULE_CATCH_UP_WINDOW_MS + 1
    })
    await runDueSamwooSchedules(deps)
    expect(deps.send).not.toHaveBeenCalled()
    expect(runs[0]).toMatchObject({ status: 'skipped', occurrenceAt: MONDAY_0800 })
  })

  it('runs a non-mail schedule without attaching a mail token', async () => {
    const { deps, runs } = makeDeps({ getMailToken: () => null })
    await runDueSamwooSchedules(deps)
    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'ai_center', mailToken: null })
    )
    expect(runs[0]).toMatchObject({ status: 'ok' })
  })

  it('records a failed send without throwing', async () => {
    const { deps, runs } = makeDeps({
      send: vi.fn(async () => {
        throw new Error('ssh down')
      })
    })
    await runDueSamwooSchedules(deps)
    expect(runs[0]).toMatchObject({ status: 'error', detail: 'ssh down' })
  })

  it('skips a disabled schedule entirely', async () => {
    const { deps, runs } = makeDeps({ listSchedules: () => [schedule({ enabled: false })] })
    await runDueSamwooSchedules(deps)
    expect(deps.send).not.toHaveBeenCalled()
    expect(runs).toEqual([])
  })

  it('does not start the same schedule twice while a send is in flight', async () => {
    const gate: { release: () => void } = { release: () => {} }
    const blocked = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const send = vi.fn(async () => {
      await blocked
      return { ok: true, reply: 'done' }
    })
    const { deps } = makeDeps({ send })
    const first = runDueSamwooSchedules(deps)
    await runDueSamwooSchedules(deps)
    expect(send).toHaveBeenCalledTimes(1)
    gate.release()
    await first
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('runSamwooScheduleNow', () => {
  it('returns a typed reason without sending while signed out', async () => {
    const { deps } = makeDeps({ getProfile: () => null, getMailToken: () => null })
    await expect(runSamwooScheduleNow(schedule(), deps)).resolves.toEqual({
      ok: false,
      reason: 'signed-out'
    })
    expect(deps.send).not.toHaveBeenCalled()
  })

  it('settles an already-due occurrence so the next tick cannot send it twice', async () => {
    const { deps, runs } = makeDeps()
    await expect(runSamwooScheduleNow(schedule(), deps)).resolves.toMatchObject({ ok: true })
    expect(deps.send).toHaveBeenCalledWith({
      schedule: schedule(),
      profile: 'ai_center',
      mailToken: 'token-123',
      occurrenceAt: MONDAY_0800
    })
    expect(runs[0]).toMatchObject({ status: 'ok', occurrenceAt: MONDAY_0800 })

    deps.lastOccurrenceAt = () => runs[0].occurrenceAt
    await runDueSamwooSchedules(deps)
    expect(deps.send).toHaveBeenCalledTimes(1)
  })

  it('uses a fresh id when manually rerunning an occurrence already settled', async () => {
    const { deps } = makeDeps({ lastOccurrenceAt: () => MONDAY_0800 })
    await runSamwooScheduleNow(schedule(), deps)
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ occurrenceAt: MONDAY_0900 }))
  })
})
