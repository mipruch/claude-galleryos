import { describe, it, expect } from 'vitest'
import type { WidgetBinding } from '@gallery/driver-core'
import { deviceActions } from '@/lib/commands'
import type { DeviceRecord, DeviceState } from '@/lib/devices'
import { makeDevice } from './fixtures'

function dev(capabilities: string[]): DeviceRecord {
  return makeDevice({ id: 'd', name: 'D', type: 'custom', capabilities })
}

describe('deviceActions', () => {
  it('maps on/off/mute and skips param-heavy commands (setInput)', () => {
    const actions = deviceActions(dev(['on', 'off', 'setInput', 'setMute']), {}, [])
    expect(actions.map((a) => a.label)).toEqual(['Turn on', 'Turn off', 'Mute', 'Unmute'])
    expect(actions[0]).toMatchObject({ command: 'on', params: {}, optimistic: { on: true, power: 'on' } })
  })

  it('expands setLevel into presets with level params + optimistic level', () => {
    const actions = deviceActions(dev(['setLevel', 'setMute']), {}, [])
    expect(actions.map((a) => a.label)).toEqual(['Mute', 'Unmute', 'Set 100%', 'Set 50%', 'Set 0%'])
    const full = actions.find((a) => a.label === 'Set 100%')!
    expect(full).toMatchObject({ command: 'setLevel', params: { level: 1 }, optimistic: { level: 1 } })
  })

  it('uses the brightness state key for setBrightness presets', () => {
    const actions = deviceActions(dev(['on', 'off', 'setBrightness', 'recall']), {}, [])
    expect(actions.map((a) => a.label)).toEqual(['Turn on', 'Turn off', 'Set 100%', 'Set 50%', 'Set 0%'])
    const half = actions.find((a) => a.label === 'Set 50%')!
    expect(half).toMatchObject({ command: 'setBrightness', params: { level: 0.5 }, optimistic: { brightness: 0.5 } })
  })

  it('includes short pulses and returns nothing for an uncontrollable device', () => {
    expect(deviceActions(dev(['on', 'off', 'shortOff']), {}, []).map((a) => a.label)).toEqual([
      'Turn on',
      'Turn off',
      'Pulse off',
    ])
    expect(deviceActions(dev(['send']), {}, [])).toEqual([])
  })

  // A select-kind widget (e.g. a matrix output's input picker) generates one
  // action per option, generically — no per-driver/subtype special case.
  describe('select-kind widget bindings', () => {
    const binding: WidgetBinding = {
      kind: 'select',
      command: 'setInput',
      paramKey: 'input',
      stateKey: 'input',
      optionsKey: 'options',
    }

    it('generates one action per option from the driver-embedded state', () => {
      const state: DeviceState = {
        options: [
          { value: 0, label: 'None' },
          { value: 1, label: '1. Lectern' },
        ],
      }
      const actions = deviceActions(dev([]), state, [binding])
      expect(actions).toEqual([
        { id: 'setInput-0', label: 'None', command: 'setInput', params: { input: 0 }, optimistic: { input: 0 } },
        {
          id: 'setInput-1',
          label: '1. Lectern',
          command: 'setInput',
          params: { input: 1 },
          optimistic: { input: 1 },
        },
      ])
    })

    it('falls back to the manifest-declared static options when state has none', () => {
      const staticBinding: WidgetBinding = {
        kind: 'select',
        command: 'setInput',
        paramKey: 'input',
        stateKey: 'input',
        options: [{ value: 'a', label: 'A' }],
      }
      expect(deviceActions(dev([]), {}, [staticBinding])).toEqual([
        { id: 'setInput-a', label: 'A', command: 'setInput', params: { input: 'a' }, optimistic: { input: 'a' } },
      ])
    })

    it('produces no select actions when no select binding is present', () => {
      expect(deviceActions(dev([]), {}, [])).toEqual([])
    })
  })
})
