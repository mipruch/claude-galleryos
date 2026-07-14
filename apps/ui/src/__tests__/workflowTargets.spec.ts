import { describe, it, expect } from 'vitest'
import { resolveTargetNames, targetSummary, targetTypeLabel, usesParams } from '@/lib/workflowTargets'

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
  it('falls back to an "unknown" label when nothing resolves', () => {
    expect(targetSummary('scene.execute', {})).toBe('Unknown scene')
    expect(targetSummary('device.command', {})).toBe('Unknown device')
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
  it('leaves the name undefined when targetId matches nothing', () => {
    expect(resolveTargetNames({ targetType: 'scene.execute', targetId: 'nope', targetCommand: null }, scenes, devices)).toEqual({
      sceneName: undefined,
      deviceName: undefined,
      command: null,
    })
  })
})
