import { describe, expect, it } from 'vitest'
import type { DriverManifest } from '@gallery/driver-core'
import { capabilityLabels, formatUptime } from '@/lib/system'

describe('formatUptime', () => {
  it('picks the largest sensible unit pair', () => {
    expect(formatUptime(42_000)).toBe('42s')
    expect(formatUptime(5 * 60_000 + 12_000)).toBe('5m 12s')
    expect(formatUptime(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m')
    expect(formatUptime(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h')
  })

  it('returns a dash for missing or negative values', () => {
    expect(formatUptime(undefined)).toBe('—')
    expect(formatUptime(0)).toBe('—')
    expect(formatUptime(-5)).toBe('—')
  })
})

describe('capabilityLabels', () => {
  const manifest = (caps: Partial<DriverManifest['capabilities']>): DriverManifest =>
    ({ capabilities: { discovery: false, subscriptions: false, bidirectional: false, ...caps } }) as DriverManifest

  it('lists only the enabled capabilities', () => {
    expect(capabilityLabels(manifest({ discovery: true, bidirectional: true }))).toEqual([
      'discovery',
      'bidirectional',
    ])
    expect(capabilityLabels(manifest({}))).toEqual([])
  })
})
