import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { normalizeScheduleDays } from '../../../../shared/samwoo-schedule'

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

/** Why a literal switch and not a computed key: the localization extraction gate
 *  only sees `translate` calls with a static key. */
function weekdayShortLabel(weekday: number): string {
  switch (weekday) {
    case 0:
      return translate('samwoo.schedules.weekdaySun', 'Su')
    case 1:
      return translate('samwoo.schedules.weekdayMon', 'Mo')
    case 2:
      return translate('samwoo.schedules.weekdayTue', 'Tu')
    case 3:
      return translate('samwoo.schedules.weekdayWed', 'We')
    case 4:
      return translate('samwoo.schedules.weekdayThu', 'Th')
    case 5:
      return translate('samwoo.schedules.weekdayFri', 'Fr')
    default:
      return translate('samwoo.schedules.weekdaySat', 'Sa')
  }
}

/** Human summary for a stored day set: empty is the stored form of every day. */
export function weekdayLabels(days: readonly number[]): string {
  return days.length === 0
    ? translate('samwoo.schedules.everyDay', 'Every day')
    : days.map(weekdayShortLabel).join(' ')
}

/** Toggle one weekday. An empty stored set means every day, so the first click
 *  starts from all-selected and removes that day rather than isolating it.
 *  Returns the previous set unchanged when the toggle would clear every day —
 *  a schedule with no days can never fire. */
export function toggleScheduleWeekday(days: readonly number[], weekday: number): number[] {
  const current = days.length === 0 ? ALL_WEEKDAYS : [...days]
  const selected = new Set(current)
  if (selected.has(weekday)) {
    selected.delete(weekday)
  } else {
    selected.add(weekday)
  }
  return selected.size === 0 ? normalizeScheduleDays(days) : normalizeScheduleDays([...selected])
}

export function SamwooScheduleDayPicker({
  days,
  onChange
}: {
  days: number[]
  onChange: (days: number[]) => void
}): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label={translate('samwoo.schedules.days', 'Days')}
    >
      {ALL_WEEKDAYS.map((weekday) => {
        const active = days.length === 0 || days.includes(weekday)
        return (
          <button
            key={weekday}
            type="button"
            aria-pressed={active}
            aria-label={weekdayShortLabel(weekday)}
            onClick={() => onChange(toggleScheduleWeekday(days, weekday))}
            className={cn(
              'size-6 rounded text-[11px] font-medium transition-colors',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {weekdayShortLabel(weekday)}
          </button>
        )
      })}
    </div>
  )
}
