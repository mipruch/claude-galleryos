import { describe, it, expect } from 'vitest'
import type { LogDTO } from '@gallery/types'
import { formatDuration, formatLogTime, levelVariant, logsToCsv } from '@/lib/logs'

function makeLog(over: Partial<LogDTO> = {}): LogDTO {
  return {
    id: 1,
    ts: '2026-06-22T08:30:00.000Z',
    level: 'info',
    source: 'scene_engine',
    entityType: 'scene',
    entityId: 'abc',
    message: 'hello',
    metadata: {},
    durationMs: null,
    ...over,
  } as unknown as LogDTO
}

describe('levelVariant', () => {
  it('maps each level to a badge variant', () => {
    expect(levelVariant('error')).toBe('destructive')
    expect(levelVariant('warn')).toBe('default')
    expect(levelVariant('info')).toBe('secondary')
    expect(levelVariant('debug')).toBe('outline')
    expect(levelVariant('whatever')).toBe('outline')
  })
})

describe('formatLogTime', () => {
  it('renders an instant in the requested zone (pinned for determinism)', () => {
    const out = formatLogTime('2026-06-22T08:30:15.000Z', 'en-GB', 'UTC')
    expect(out).toContain('08:30:15')
  })

  it('returns empty string for missing/invalid input', () => {
    expect(formatLogTime(null)).toBe('')
    expect(formatLogTime(undefined)).toBe('')
    expect(formatLogTime('nope')).toBe('')
  })
})

describe('formatDuration', () => {
  it('uses ms under a second and seconds above', () => {
    expect(formatDuration(340)).toBe('340ms')
    expect(formatDuration(1200)).toBe('1.2s')
    expect(formatDuration(45_000)).toBe('45s')
  })

  it('returns empty string when absent', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(undefined)).toBe('')
  })
})

describe('logsToCsv', () => {
  it('emits a header and one row per log', () => {
    const csv = logsToCsv([makeLog({ id: 1, message: 'a' }), makeLog({ id: 2, message: 'b' })])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('ts,level,source,entityType,entityId,message,durationMs,metadata')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('a')
    expect(lines[2]).toContain('b')
  })

  it('quotes fields containing commas, quotes or newlines', () => {
    const csv = logsToCsv([makeLog({ message: 'has, comma and "quote"' })])
    expect(csv.split('\n')[1]).toContain('"has, comma and ""quote"""')
  })

  it('json-encodes the metadata object into one field', () => {
    const csv = logsToCsv([makeLog({ metadata: { a: 1 } })])
    expect(csv.split('\n')[1]).toContain('"{""a"":1}"')
  })
})
