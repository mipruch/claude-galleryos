import { describe, it, expect } from 'vitest'
import {
  isValidParamsTemplate,
  parseParamsTemplate,
  parseTestArgs,
  protocolLabel,
  stringifyParamsTemplate,
  targetSummary,
  targetTypeLabel,
  usesParams,
} from '@/lib/mappings'

describe('labels', () => {
  it('maps protocol + target-type values to display labels, falling back gracefully', () => {
    expect(protocolLabel('osc')).toBe('OSC')
    expect(protocolLabel('mystery')).toBe('MYSTERY')
    expect(targetTypeLabel('scene.execute')).toBe('Run scene')
    expect(targetTypeLabel('device.command')).toBe('Device command')
    expect(targetTypeLabel('whatever')).toBe('whatever')
  })
})

describe('targetSummary', () => {
  it('describes a scene target', () => {
    expect(targetSummary('scene.execute', { sceneName: 'Welcome' })).toBe('Run “Welcome”')
  })
  it('describes a device command target', () => {
    expect(targetSummary('device.command', { deviceName: 'Dimmer', command: 'setLevel' })).toBe(
      'Dimmer · setLevel',
    )
  })
  it('describes an event target and falls back when names are missing', () => {
    expect(targetSummary('event.emit', {})).toBe('Emit event')
    expect(targetSummary('scene.execute', {})).toBe('Run “—”')
  })
})

describe('usesParams', () => {
  it('is true for device.command and event.emit only', () => {
    expect(usesParams('device.command')).toBe(true)
    expect(usesParams('event.emit')).toBe(true)
    expect(usesParams('scene.execute')).toBe(false)
  })
})

describe('parseParamsTemplate', () => {
  it('treats blank as an empty object', () => {
    expect(parseParamsTemplate('   ')).toEqual({ ok: true, value: {} })
  })
  it('accepts a JSON object', () => {
    expect(parseParamsTemplate('{"level":"{:level}"}')).toEqual({
      ok: true,
      value: { level: '{:level}' },
    })
  })
  it('rejects invalid JSON', () => {
    const r = parseParamsTemplate('{nope}')
    expect(r.ok).toBe(false)
  })
  it('rejects non-objects (array / primitive)', () => {
    expect(parseParamsTemplate('[1,2]').ok).toBe(false)
    expect(parseParamsTemplate('42').ok).toBe(false)
  })
  it('isValidParamsTemplate mirrors parse success', () => {
    expect(isValidParamsTemplate('{}')).toBe(true)
    expect(isValidParamsTemplate('[1]')).toBe(false)
  })
})

describe('stringifyParamsTemplate', () => {
  it('renders an empty template as "{}"', () => {
    expect(stringifyParamsTemplate(undefined)).toBe('{}')
    expect(stringifyParamsTemplate({})).toBe('{}')
  })
  it('pretty-prints a non-empty template', () => {
    expect(stringifyParamsTemplate({ a: 1 })).toBe('{\n  "a": 1\n}')
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
