import { describe, it, expect } from 'vitest'
import { formatDateTime, formatRelative, nextRunOf, sortByNextRun } from '@/lib/schedules'
import { makeSchedule } from './fixtures'

// A fixed "now" so relative labels are deterministic.
const NOW = Date.parse('2026-06-22T08:00:00.000Z') // Monday

describe('nextRunOf', () => {
  it('prefers the first previewed run', () => {
    const job = makeSchedule({ nextRunAt: '2026-06-23T06:30:00.000Z' })
    expect(nextRunOf(job, ['2026-06-22T06:30:00.000Z', '2026-06-23T06:30:00.000Z'])).toBe(
      '2026-06-22T06:30:00.000Z',
    )
  })

  it('falls back to the stored nextRunAt when there is no preview', () => {
    const job = makeSchedule({ nextRunAt: '2026-06-23T06:30:00.000Z' })
    expect(nextRunOf(job, undefined)).toBe('2026-06-23T06:30:00.000Z')
    expect(nextRunOf(job, [])).toBe('2026-06-23T06:30:00.000Z')
  })

  it('returns null when nothing is known', () => {
    expect(nextRunOf(makeSchedule({ nextRunAt: null }), undefined)).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('renders a UTC instant in the requested zone (pinned for determinism)', () => {
    const out = formatDateTime('2026-06-22T08:30:00.000Z', 'en-GB', 'UTC')
    // Don't assert exact punctuation (varies by ICU); assert the parts.
    expect(out).toContain('Jun')
    expect(out).toContain('22')
    expect(out).toContain('08:30')
  })

  it('converts to the given timezone (Prague is UTC+2 in summer)', () => {
    const out = formatDateTime('2026-06-22T06:30:00.000Z', 'en-GB', 'Europe/Prague')
    expect(out).toContain('08:30') // 06:30Z → 08:30 local
  })

  it('returns empty string for missing/invalid input', () => {
    expect(formatDateTime(null)).toBe('')
    expect(formatDateTime(undefined)).toBe('')
    expect(formatDateTime('not-a-date')).toBe('')
  })
})

describe('formatRelative', () => {
  const rel = (iso: string) => formatRelative(iso, NOW, 'en')

  it('labels sub-minute differences as "now"', () => {
    expect(rel('2026-06-22T08:00:30.000Z')).toBe('now')
  })

  it('uses minutes, hours, days, and weeks at the right thresholds', () => {
    expect(rel('2026-06-22T08:05:00.000Z')).toBe('in 5 minutes')
    expect(rel('2026-06-22T10:00:00.000Z')).toBe('in 2 hours')
    expect(rel('2026-06-23T08:00:00.000Z')).toBe('tomorrow') // numeric:auto
    expect(rel('2026-06-25T08:00:00.000Z')).toBe('in 3 days')
    expect(rel('2026-07-06T08:00:00.000Z')).toBe('in 2 weeks')
  })

  it('handles past instants (for "last run")', () => {
    expect(rel('2026-06-22T07:55:00.000Z')).toBe('5 minutes ago')
    expect(rel('2026-06-21T08:00:00.000Z')).toBe('yesterday')
  })

  it('returns empty string for missing/invalid input', () => {
    expect(formatRelative(null, NOW)).toBe('')
    expect(formatRelative('nope', NOW)).toBe('')
  })
})

describe('sortByNextRun', () => {
  it('orders by soonest upcoming run, with unknown runs last', () => {
    const a = makeSchedule({ id: 'a', name: 'A', nextRunAt: '2026-06-23T00:00:00.000Z' })
    const b = makeSchedule({ id: 'b', name: 'B', nextRunAt: '2026-06-22T12:00:00.000Z' })
    const c = makeSchedule({ id: 'c', name: 'C', nextRunAt: null }) // no run

    // `b`'s preview makes it sooner than its stored nextRunAt would suggest.
    const previews = { a: ['2026-06-23T00:00:00.000Z'], b: ['2026-06-22T09:00:00.000Z'] }
    expect(sortByNextRun([a, b, c], previews).map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })

  it('breaks ties on the schedule name', () => {
    const x = makeSchedule({ id: 'x', name: 'Zebra', nextRunAt: '2026-06-22T09:00:00.000Z' })
    const y = makeSchedule({ id: 'y', name: 'Apple', nextRunAt: '2026-06-22T09:00:00.000Z' })
    expect(sortByNextRun([x, y], {}).map((s) => s.name)).toEqual(['Apple', 'Zebra'])
  })

  it('does not mutate the input array', () => {
    const list = [
      makeSchedule({ id: 'a', nextRunAt: '2026-06-23T00:00:00.000Z' }),
      makeSchedule({ id: 'b', nextRunAt: '2026-06-22T00:00:00.000Z' }),
    ]
    const before = list.map((s) => s.id)
    sortByNextRun(list, {})
    expect(list.map((s) => s.id)).toEqual(before)
  })
})
