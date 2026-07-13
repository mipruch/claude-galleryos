import { describe, it, expect } from 'vitest'
import { parseTestArgs, protocolLabel } from '@/lib/mappings'

describe('labels', () => {
  it('maps protocol values to display labels, falling back gracefully', () => {
    expect(protocolLabel('osc')).toBe('OSC')
    expect(protocolLabel('mystery')).toBe('MYSTERY')
  })
})

describe('parseTestArgs', () => {
  it('blank → empty array', () => {
    expect(parseTestArgs('  ')).toEqual([])
  })
  it('a JSON array → itself', () => {
    expect(parseTestArgs('["HDMI1", 2]')).toEqual(['HDMI1', 2])
  })
  it('a bare JSON value → single-element array', () => {
    expect(parseTestArgs('0.5')).toEqual([0.5])
  })
  it('non-JSON text → one string argument', () => {
    expect(parseTestArgs('HDMI1')).toEqual(['HDMI1'])
  })
})
