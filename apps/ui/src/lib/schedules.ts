/**
 * Schedule (CRON job) domain helpers for the read-only monitoring view.
 *
 * The server stores and returns everything in **UTC** (ISO strings); converting
 * to the viewer's local time is display logic and lives here. The record type is
 * the shared `@gallery/types` DTO (`GET /api/v1/schedules` row); the next-run
 * preview comes from `GET /api/v1/schedules/:id/next`.
 *
 * `locale` / `timeZone` are injectable so these functions are deterministic in
 * tests; the view calls them without arguments to use the browser's locale/zone.
 */

import type { ScheduledJobDTO } from '@gallery/types'

/** Soonest upcoming run for a schedule: first previewed run, else stored `nextRunAt`. */
export function nextRunOf(schedule: ScheduledJobDTO, previews: string[] | undefined): string | null {
  return previews?.[0] ?? schedule.nextRunAt ?? null
}

/**
 * Format a UTC ISO timestamp as an absolute local date-time, e.g. "Mon 22 Jun,
 * 08:30". Returns `''` for a missing/invalid value so callers can guard cheaply.
 */
export function formatDateTime(iso: string | null | undefined, locale?: string, timeZone?: string): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(ms)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/**
 * A coarse, human relative label for a future (or past) instant, e.g. "in 5 min",
 * "tomorrow", "in 3 days". Picks the largest sensible unit; uses `Intl`'s
 * `numeric: 'auto'` so ±1 day reads as "tomorrow"/"yesterday". Returns `''` for an
 * invalid value.
 */
export function formatRelative(iso: string | null | undefined, nowMs: number, locale?: string): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const diff = ms - nowMs
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(diff)

  if (abs < MINUTE) return rtf.format(0, 'second') // "now"
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), 'minute')
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour')
  if (abs < WEEK) return rtf.format(Math.round(diff / DAY), 'day')
  return rtf.format(Math.round(diff / WEEK), 'week')
}

/**
 * Order schedules by their soonest upcoming run (ascending). Schedules with no
 * known next run sink to the bottom; ties fall back to the schedule name.
 */
export function sortByNextRun(
  schedules: ScheduledJobDTO[],
  previews: Record<string, string[]>,
): ScheduledJobDTO[] {
  const key = (s: ScheduledJobDTO): number => {
    const next = nextRunOf(s, previews[s.id])
    const ms = next ? Date.parse(next) : NaN
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
  }
  return [...schedules].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name))
}
