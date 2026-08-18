/**
 * CRON builder/humanizer for the redesigned schedule trigger form
 * (`CronScheduleForm.vue`). `lib/schedules.ts` already owns the raw
 * 5-field validity check (`isValidCron`) and next-run/relative-time
 * formatting for the read-only monitoring views; this module is the
 * two-way mapping between that raw expression and the friendlier
 * "Repeats: Daily/Weekly/Monthly/Interval/Custom" picker the trigger
 * inspector now edits instead of a bare text field.
 *
 * `stateFromCron`/`cronFromState` round-trip through a small
 * `CronBuilderState` — the picker's own field values — so opening an
 * existing schedule pre-selects the closest matching mode (falling back to
 * "Custom", which just edits the raw expression) and every picker edit
 * regenerates a valid 5-field cron string.
 */

import { isValidCron } from './schedules'

export type RepeatMode = 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom'

export interface CronBuilderState {
  mode: RepeatMode
  /** 0-23, used by daily/weekly/monthly. */
  hour: number
  /** 0-59, used by daily/weekly/monthly. */
  minute: number
  /** Cron `day-of-week` values (0=Sunday .. 6=Saturday), used by weekly. */
  weekdays: number[]
  /** 1-31, used by monthly. */
  dayOfMonth: number
  intervalUnit: 'minutes' | 'hours'
  /** How many `intervalUnit`s between fires, used by interval. */
  intervalValue: number
  /** The raw 5-field expression — authoritative for "custom", a generated preview otherwise. */
  customExpr: string
}

const CRON_FIELD_COUNT = 5

interface CronFields {
  minute: string
  hour: string
  dom: string
  month: string
  dow: string
}

function splitCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== CRON_FIELD_COUNT) return null
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string]
  return { minute, hour, dom, month, dow }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Short Monday-first weekday labels for the toggle row (index = cron `dow`, 0=Sunday). */
export const WEEKDAY_SHORT_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
/** Full weekday names, same 0=Sunday indexing — internal to {@link weekdayLongName}, which humanizeCron/Sentence use for a single-day description. */
const WEEKDAY_LONG_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const
/** Display order for the weekday toggle row: Monday first, Sunday last. */
export const WEEKDAY_DISPLAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0]

const DEFAULT_WEEKLY_DAYS = [1] // Monday

/** A fresh builder state for a brand-new schedule (daily at 08:00). */
export function defaultCronState(): CronBuilderState {
  return {
    mode: 'daily',
    hour: 8,
    minute: 0,
    weekdays: [...DEFAULT_WEEKLY_DAYS],
    dayOfMonth: 1,
    intervalUnit: 'hours',
    intervalValue: 1,
    customExpr: '0 8 * * *',
  }
}

/** Parse a stored cron expression into the closest matching builder state; unrecognized shapes fall back to "custom". */
export function stateFromCron(expr: string): CronBuilderState {
  const base = defaultCronState()
  base.customExpr = expr
  const fields = splitCron(expr)
  if (!fields || !isValidCron(expr)) return { ...base, mode: 'custom' }

  const minuteNum = Number(fields.minute)
  const hourNum = Number(fields.hour)
  const simpleTime = /^\d+$/.test(fields.minute) && /^\d+$/.test(fields.hour)

  // `* * D * *` (fixed minute+hour, any day) is a straightforward "N times a
  // day" interval reading only for the trivial "every hour on the hour" case;
  // anything else with a `*/N` step is treated as an interval schedule.
  const minuteStepMatch = /^\*\/(\d+)$/.exec(fields.minute)
  const hourStepMatch = /^\*\/(\d+)$/.exec(fields.hour)
  if (fields.dom === '*' && fields.month === '*' && fields.dow === '*') {
    if (minuteStepMatch && fields.hour === '*') {
      return { ...base, mode: 'interval', intervalUnit: 'minutes', intervalValue: Number(minuteStepMatch[1]) }
    }
    if (hourStepMatch && fields.minute === '0') {
      return { ...base, mode: 'interval', intervalUnit: 'hours', intervalValue: Number(hourStepMatch[1]) }
    }
    if (simpleTime) {
      return { ...base, mode: 'daily', hour: hourNum, minute: minuteNum }
    }
  }

  if (fields.month === '*' && simpleTime) {
    const expandedWeekdays = expandDowField(fields.dow)
    if (fields.dom === '*' && expandedWeekdays) {
      return { ...base, mode: 'weekly', hour: hourNum, minute: minuteNum, weekdays: expandedWeekdays }
    }
    if (fields.dow === '*' && /^\d+$/.test(fields.dom)) {
      return { ...base, mode: 'monthly', hour: hourNum, minute: minuteNum, dayOfMonth: Number(fields.dom) }
    }
  }

  return { ...base, mode: 'custom' }
}

/** Build the 5-field cron expression the current picker state describes. */
export function cronFromState(state: CronBuilderState): string {
  const time = `${state.minute} ${state.hour}`
  switch (state.mode) {
    case 'daily':
      return `${time} * * *`
    case 'weekly': {
      const days = state.weekdays.length ? [...new Set(state.weekdays)].sort() : DEFAULT_WEEKLY_DAYS
      return `${time} * * ${days.join(',')}`
    }
    case 'monthly':
      return `${time} ${state.dayOfMonth} * *`
    case 'interval':
      return state.intervalUnit === 'minutes'
        ? `*/${state.intervalValue} * * * *`
        : `0 */${state.intervalValue} * * *`
    case 'custom':
    default:
      return state.customExpr
  }
}

/**
 * Expand a cron `day-of-week` field into individual day numbers, accepting
 * both a comma-list of single days (`1,3,5`) and ranges (`1-5`), or a mix
 * (`0,6` / `1-3,5`) — `null` if the field isn't a plain weekday set (e.g. a
 * step interval), which the picker has no dedicated mode for.
 */
function expandDowField(field: string): number[] | null {
  if (!/^[0-6](-[0-6])?(,[0-6](-[0-6])?)*$/.test(field)) return null
  const days = new Set<number>()
  for (const part of field.split(',')) {
    const range = /^(\d)-(\d)$/.exec(part)
    if (range) {
      const [start, end] = [Number(range[1]), Number(range[2])]
      if (start > end) return null
      for (let d = start; d <= end; d++) days.add(d)
    } else {
      days.add(Number(part))
    }
  }
  return [...days]
}

/** `WEEKDAY_LONG_LABELS[day]`, defaulting to Sunday for an out-of-range index (never hit for a real cron `dow` value, 0-6). */
const weekdayLongName = (day: number): string => WEEKDAY_LONG_LABELS[day] ?? WEEKDAY_LONG_LABELS[0]

/** Weekday names joined for a humanized description, e.g. "Monday" for a single day or "Mon, Wed, Fri" for several. */
function weekdayList(days: number[]): string {
  const sorted = [...new Set(days)].sort(
    (a, b) => WEEKDAY_DISPLAY_ORDER.indexOf(a) - WEEKDAY_DISPLAY_ORDER.indexOf(b),
  )
  if (sorted.length === 1) return weekdayLongName(sorted[0] ?? 0)
  return sorted.map((d) => weekdayLongName(d).slice(0, 3)).join(', ')
}

const isWeekdaySet = (days: number[]): boolean => {
  const sorted = [...new Set(days)].sort()
  return sorted.length === 5 && [1, 2, 3, 4, 5].every((d) => sorted.includes(d))
}
const isWeekendSet = (days: number[]): boolean => {
  const sorted = [...new Set(days)].sort()
  return sorted.length === 2 && sorted.includes(0) && sorted.includes(6)
}

/**
 * Short, lowercase description for a trigger card's subtitle line, e.g.
 * "daily, 08:00" / "weekdays, 08:30" / "Mondays, 01:40". Returns `''` for a
 * cron shape too irregular to describe (the raw expression alone is shown).
 */
export function describeCron(expr: string): string {
  const state = stateFromCron(expr)
  const time = `${pad2(state.hour)}:${pad2(state.minute)}`
  switch (state.mode) {
    case 'daily':
      return `daily, ${time}`
    case 'weekly':
      if (isWeekdaySet(state.weekdays)) return `weekdays, ${time}`
      if (isWeekendSet(state.weekdays)) return `weekends, ${time}`
      return `${weekdayList(state.weekdays)}${state.weekdays.length === 1 ? 's' : ''}, ${time}`
    case 'monthly':
      return `day ${state.dayOfMonth} monthly, ${time}`
    case 'interval':
      return state.intervalUnit === 'minutes'
        ? `every ${state.intervalValue} min`
        : `every ${state.intervalValue}h`
    default:
      return ''
  }
}

/**
 * A full sentence for the cron form's highlighted summary box, e.g. "Every
 * day at 08:00" / "Every Monday at 01:40" / "Every weekday at 08:30".
 */
export function describeCronSentence(expr: string): string {
  const state = stateFromCron(expr)
  const time = `${pad2(state.hour)}:${pad2(state.minute)}`
  switch (state.mode) {
    case 'daily':
      return `Every day at ${time}`
    case 'weekly':
      if (isWeekdaySet(state.weekdays)) return `Every weekday at ${time}`
      if (isWeekendSet(state.weekdays)) return `Every weekend day at ${time}`
      return `Every ${weekdayList(state.weekdays)} at ${time}`
    case 'monthly':
      return `On day ${state.dayOfMonth} of the month at ${time}`
    case 'interval':
      return state.intervalUnit === 'minutes'
        ? `Every ${state.intervalValue} minute${state.intervalValue === 1 ? '' : 's'}`
        : `Every ${state.intervalValue} hour${state.intervalValue === 1 ? '' : 's'}`
    default:
      return 'Custom schedule'
  }
}
