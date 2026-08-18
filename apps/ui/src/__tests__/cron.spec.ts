import { describe, expect, it } from 'vitest'
import { cronFromState, defaultCronState, describeCron, describeCronSentence, stateFromCron } from '@/lib/cron'

describe('stateFromCron / cronFromState round-trip', () => {
  it('recognizes a daily expression', () => {
    const state = stateFromCron('0 8 * * *')
    expect(state.mode).toBe('daily')
    expect(state.hour).toBe(8)
    expect(state.minute).toBe(0)
    expect(cronFromState(state)).toBe('0 8 * * *')
  })

  it('recognizes a single-weekday expression', () => {
    const state = stateFromCron('40 1 * * 1')
    expect(state.mode).toBe('weekly')
    expect(state.weekdays).toEqual([1])
    expect(cronFromState(state)).toBe('40 1 * * 1')
  })

  it('recognizes a weekdays (Mon-Fri) range expression, normalizing to a comma list on rebuild', () => {
    const state = stateFromCron('30 8 * * 1-5')
    expect(state.mode).toBe('weekly')
    expect(state.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(cronFromState(state)).toBe('30 8 * * 1,2,3,4,5')
  })

  it('recognizes a comma-listed weekday set as weekdays', () => {
    const state = stateFromCron('30 8 * * 1,2,3,4,5')
    expect(state.mode).toBe('weekly')
    expect(state.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(cronFromState(state)).toBe('30 8 * * 1,2,3,4,5')
  })

  it('recognizes a monthly expression', () => {
    const state = stateFromCron('0 9 15 * *')
    expect(state.mode).toBe('monthly')
    expect(state.dayOfMonth).toBe(15)
    expect(cronFromState(state)).toBe('0 9 15 * *')
  })

  it('recognizes a minute-interval expression', () => {
    const state = stateFromCron('*/15 * * * *')
    expect(state.mode).toBe('interval')
    expect(state.intervalUnit).toBe('minutes')
    expect(state.intervalValue).toBe(15)
    expect(cronFromState(state)).toBe('*/15 * * * *')
  })

  it('recognizes an hour-interval expression', () => {
    const state = stateFromCron('0 */4 * * *')
    expect(state.mode).toBe('interval')
    expect(state.intervalUnit).toBe('hours')
    expect(state.intervalValue).toBe(4)
    expect(cronFromState(state)).toBe('0 */4 * * *')
  })

  it('falls back to custom for an unrecognized shape, preserving the raw expression', () => {
    const state = stateFromCron('0 0,12 1 */2 *')
    expect(state.mode).toBe('custom')
    expect(cronFromState(state)).toBe('0 0,12 1 */2 *')
  })

  it('falls back to custom for an invalid expression rather than throwing', () => {
    const state = stateFromCron('not a cron')
    expect(state.mode).toBe('custom')
    expect(cronFromState(state)).toBe('not a cron')
  })

  it('builds a valid weekly cron from a fresh default state', () => {
    const state = defaultCronState()
    state.mode = 'weekly'
    state.weekdays = [1, 3, 5]
    state.hour = 8
    state.minute = 30
    expect(cronFromState(state)).toBe('30 8 * * 1,3,5')
  })
})

describe('describeCron', () => {
  it('describes daily', () => {
    expect(describeCron('0 8 * * *')).toBe('daily, 08:00')
  })

  it('describes a single weekday', () => {
    expect(describeCron('40 1 * * 1')).toBe('Mondays, 01:40')
  })

  it('describes a comma-listed Mon-Fri set as weekdays', () => {
    expect(describeCron('30 8 * * 1,2,3,4,5')).toBe('weekdays, 08:30')
  })

  it('describes a Mon-Fri range as weekdays', () => {
    expect(describeCron('30 8 * * 1-5')).toBe('weekdays, 08:30')
  })

  it('describes a weekend set', () => {
    expect(describeCron('0 10 * * 0,6')).toBe('weekends, 10:00')
  })

  it('describes a monthly schedule', () => {
    expect(describeCron('0 9 15 * *')).toBe('day 15 monthly, 09:00')
  })

  it('describes a minute interval', () => {
    expect(describeCron('*/15 * * * *')).toBe('every 15 min')
  })

  it('returns empty for an irregular expression', () => {
    expect(describeCron('0 0,12 1 */2 *')).toBe('')
  })
})

describe('describeCronSentence', () => {
  it('describes daily', () => {
    expect(describeCronSentence('0 8 * * *')).toBe('Every day at 08:00')
  })

  it('describes a single weekday', () => {
    expect(describeCronSentence('40 1 * * 1')).toBe('Every Monday at 01:40')
  })

  it('describes a weekday set', () => {
    expect(describeCronSentence('30 8 * * 1,2,3,4,5')).toBe('Every weekday at 08:30')
  })

  it('falls back to a generic label for an irregular expression', () => {
    expect(describeCronSentence('0 0,12 1 */2 *')).toBe('Custom schedule')
  })
})
