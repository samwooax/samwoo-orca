import { describe, expect, it } from 'vitest'
import { toggleScheduleWeekday } from './samwoo-schedule-day-picker'

describe('toggleScheduleWeekday', () => {
  it('removes one day from the every-day form rather than isolating it', () => {
    // Empty means every day and renders as all-selected, so the first click has
    // to read as "turn this one off".
    expect(toggleScheduleWeekday([], 0)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('adds a day back and collapses a full week to the every-day form', () => {
    expect(toggleScheduleWeekday([1, 2, 3, 4, 5, 6], 0)).toEqual([])
  })

  it('toggles a single day off within a partial selection', () => {
    expect(toggleScheduleWeekday([1, 3, 5], 3)).toEqual([1, 5])
  })

  it('refuses to clear the last remaining day', () => {
    // A schedule with no days could never fire, so the toggle is a no-op.
    expect(toggleScheduleWeekday([2], 2)).toEqual([2])
  })
})
