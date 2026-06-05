import { describe, it, expect } from 'vitest'
import { deviceActions } from '@/lib/commands'
import type { DeviceRecord } from '@/lib/devices'

function dev(capabilities: string[]): DeviceRecord {
  return { id: 'd', name: 'D', type: 'custom', capabilities } as unknown as DeviceRecord
}

describe('deviceActions', () => {
  it('maps on/off/mute and skips param-heavy commands (setInput)', () => {
    const actions = deviceActions(dev(['on', 'off', 'setInput', 'setMute']))
    expect(actions.map((a) => a.label)).toEqual(['Turn on', 'Turn off', 'Mute', 'Unmute'])
    expect(actions[0]).toMatchObject({ command: 'on', params: {}, optimistic: { on: true, power: 'on' } })
  })

  it('expands setLevel into presets with level params + optimistic level', () => {
    const actions = deviceActions(dev(['setLevel', 'setMute']))
    expect(actions.map((a) => a.label)).toEqual(['Mute', 'Unmute', 'Set 100%', 'Set 50%', 'Set 0%'])
    const full = actions.find((a) => a.label === 'Set 100%')!
    expect(full).toMatchObject({ command: 'setLevel', params: { level: 1 }, optimistic: { level: 1 } })
  })

  it('uses the brightness state key for setBrightness presets', () => {
    const actions = deviceActions(dev(['on', 'off', 'setBrightness', 'recall']))
    expect(actions.map((a) => a.label)).toEqual(['Turn on', 'Turn off', 'Set 100%', 'Set 50%', 'Set 0%'])
    const half = actions.find((a) => a.label === 'Set 50%')!
    expect(half).toMatchObject({ command: 'setBrightness', params: { level: 0.5 }, optimistic: { brightness: 0.5 } })
  })

  it('includes short pulses and returns nothing for an uncontrollable device', () => {
    expect(deviceActions(dev(['on', 'off', 'shortOff'])).map((a) => a.label)).toEqual([
      'Turn on',
      'Turn off',
      'Pulse off',
    ])
    expect(deviceActions(dev(['send']))).toEqual([])
  })
})
