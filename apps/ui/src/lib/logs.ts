/**
 * Pure helpers for the admin log viewer — formatting, severity styling and CSV
 * export. Kept free of Vue/Pinia so they're trivially unit-testable (see
 * `__tests__/logs.spec.ts`); the store and view import from here.
 */

import type { LogDTO } from '@gallery/types'

/** Severity levels in ascending order — drives the level filter dropdown. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

/** Badge variant for a log level (matches the vendored `Badge` variants). */
export function levelVariant(level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (level) {
    case 'error':
      return 'destructive'
    case 'warn':
      return 'default'
    case 'info':
      return 'secondary'
    default:
      return 'outline'
  }
}

/**
 * Formats an ISO timestamp for a log row in the viewer's local zone, including
 * seconds (logs are dense). Returns '' for missing/invalid input so the table
 * never renders `Invalid Date`.
 *
 * @param locale - overridable for deterministic tests
 * @param timeZone - overridable for deterministic tests
 */
export function formatLogTime(
  iso: string | null | undefined,
  locale?: string,
  timeZone?: string,
): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone,
  }).format(ms)
}

/** Humanises a duration in milliseconds (e.g. `1.2s`, `340ms`). '' if absent. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

/** Quotes a single CSV field per RFC 4180 (wrap + double inner quotes). */
function csvField(value: unknown): string {
  const s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The columns exported to CSV, in order. */
const LOG_CSV_COLUMNS = ['ts', 'level', 'source', 'entityType', 'entityId', 'message', 'durationMs', 'metadata'] as const

/**
 * Serialises log rows to a CSV string (header + one row per log). `metadata` is
 * JSON-encoded into a single field. Pure — the view turns this into a download.
 */
export function logsToCsv(logs: LogDTO[]): string {
  const header = LOG_CSV_COLUMNS.join(',')
  const rows = logs.map((log) =>
    LOG_CSV_COLUMNS.map((col) => csvField((log as Record<string, unknown>)[col])).join(','),
  )
  return [header, ...rows].join('\n')
}
