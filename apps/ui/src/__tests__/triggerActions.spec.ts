import { describe, it, expect } from 'vitest'
import {
  buildTriggerActionPatch,
  isValidParams,
  parseParams,
  resolveTargetNames,
  stringifyParams,
  targetSummary,
  targetTypeLabel,
  usesParams,
} from '@/lib/triggerActions'

describe('labels', () => {
  it('maps target-type values to display labels, falling back gracefully', () => {
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
  it('falls back to "Not wired yet" when nothing is resolved', () => {
    expect(targetSummary('scene.execute', {})).toBe('Not wired yet')
    expect(targetSummary('device.command', {})).toBe('Not wired yet')
  })
  it('nudges for a command once a device is picked', () => {
    expect(targetSummary('device.command', { deviceName: 'Dimmer' })).toBe('Dimmer · pick a command')
  })
})

describe('usesParams', () => {
  it('is true for device.command only', () => {
    expect(usesParams('device.command')).toBe(true)
    expect(usesParams('scene.execute')).toBe(false)
  })
})

describe('parseParams', () => {
  it('treats blank as an empty object', () => {
    expect(parseParams('   ')).toEqual({ ok: true, value: {} })
  })
  it('accepts a JSON object', () => {
    expect(parseParams('{"level":"{:level}"}')).toEqual({
      ok: true,
      value: { level: '{:level}' },
    })
  })
  it('rejects invalid JSON', () => {
    const r = parseParams('{nope}')
    expect(r.ok).toBe(false)
  })
  it('rejects non-objects (array / primitive)', () => {
    expect(parseParams('[1,2]').ok).toBe(false)
    expect(parseParams('42').ok).toBe(false)
  })
  it('isValidParams mirrors parse success', () => {
    expect(isValidParams('{}')).toBe(true)
    expect(isValidParams('[1]')).toBe(false)
  })
})

describe('stringifyParams', () => {
  it('renders an empty object as "{}"', () => {
    expect(stringifyParams(undefined)).toBe('{}')
    expect(stringifyParams({})).toBe('{}')
  })
  it('pretty-prints a non-empty object', () => {
    expect(stringifyParams({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

describe('resolveTargetNames', () => {
  const scenes = [{ id: 's1', name: 'Welcome' }]
  const devices = [{ id: 'd1', name: 'Dimmer' }]

  it('resolves a scene name when targetId matches', () => {
    expect(resolveTargetNames({ targetType: 'scene.execute', targetId: 's1', targetCommand: null }, scenes, devices)).toEqual({
      sceneName: 'Welcome',
      deviceName: undefined,
      command: null,
    })
  })
  it('resolves a device name and passes the command through', () => {
    expect(
      resolveTargetNames({ targetType: 'device.command', targetId: 'd1', targetCommand: 'on' }, scenes, devices),
    ).toEqual({ sceneName: undefined, deviceName: 'Dimmer', command: 'on' })
  })
  it('leaves both names undefined when there is no targetId', () => {
    expect(resolveTargetNames({ targetType: 'scene.execute', targetId: null, targetCommand: null }, scenes, devices)).toEqual({
      sceneName: undefined,
      deviceName: undefined,
      command: null,
    })
  })
})

describe('buildTriggerActionPatch', () => {
  it('nulls out an empty targetId (unwired stays valid)', () => {
    expect(buildTriggerActionPatch({ targetType: 'scene.execute', targetId: '', targetCommand: '', params: '' })).toEqual({
      targetType: 'scene.execute',
      targetId: null,
      targetCommand: null,
      params: {},
    })
  })
  it('carries targetId/targetCommand/params through for a device.command action', () => {
    expect(
      buildTriggerActionPatch({
        targetType: 'device.command',
        targetId: 'd1',
        targetCommand: 'setLevel',
        params: '{"level":0.5}',
      }),
    ).toEqual({ targetType: 'device.command', targetId: 'd1', targetCommand: 'setLevel', params: { level: 0.5 } })
  })
  it('drops targetCommand and params for a scene.execute action even if the form has stale values', () => {
    expect(
      buildTriggerActionPatch({ targetType: 'scene.execute', targetId: 's1', targetCommand: 'stale', params: '{"a":1}' }),
    ).toEqual({ targetType: 'scene.execute', targetId: 's1', targetCommand: null, params: {} })
  })
  it('falls back to an empty object when the params text is invalid JSON', () => {
    expect(
      buildTriggerActionPatch({ targetType: 'device.command', targetId: 'd1', targetCommand: 'on', params: '{nope}' }),
    ).toEqual({ targetType: 'device.command', targetId: 'd1', targetCommand: 'on', params: {} })
  })
})
