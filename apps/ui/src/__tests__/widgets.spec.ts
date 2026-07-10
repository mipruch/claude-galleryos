import { describe, it, expect } from 'vitest'
import type { SelectWidgetBinding } from '@gallery/driver-core'
import {
  buttonsFor,
  isCustomWidgetType,
  isRenderableType,
  readBoolLike,
  readLevel,
  readSelected,
  selectOptions,
} from '@/lib/widgets'

describe('isCustomWidgetType / isRenderableType', () => {
  it('flags the BSS live-meter panel as the one bespoke exception', () => {
    expect(isCustomWidgetType('bss-soundweb.meter-widget')).toBe(true)
    expect(isCustomWidgetType('bss-soundweb.fader')).toBe(false)
    expect(isCustomWidgetType(null)).toBe(false)
    expect(isCustomWidgetType(undefined)).toBe(false)
  })

  it('is renderable when a custom type OR at least one generic widget is declared', () => {
    expect(isRenderableType('bss-soundweb.meter-widget', [])).toBe(true)
    expect(isRenderableType('pjlink.projector', [{ kind: 'power', trigger: 'commands', onCommand: 'on', offCommand: 'off', stateKey: 'power' }])).toBe(true)
    expect(isRenderableType('tcp-generic.endpoint', [])).toBe(false)
  })
})

describe('readBoolLike', () => {
  it('reads booleans directly', () => {
    expect(readBoolLike(true)).toBe(true)
    expect(readBoolLike(false)).toBe(false)
  })

  it('treats "on" and the transitional "warming" as on; everything else as off', () => {
    expect(readBoolLike('on')).toBe(true)
    expect(readBoolLike('warming')).toBe(true)
    expect(readBoolLike('off')).toBe(false)
    expect(readBoolLike('cooling')).toBe(false)
    expect(readBoolLike('unknown')).toBe(false)
  })

  it('defaults to false for anything else', () => {
    expect(readBoolLike(undefined)).toBe(false)
    expect(readBoolLike(null)).toBe(false)
    expect(readBoolLike(0)).toBe(false)
  })
})

describe('readLevel', () => {
  it('clamps to 0..1 and defaults to 0', () => {
    expect(readLevel(0.5)).toBe(0.5)
    expect(readLevel(1.5)).toBe(1)
    expect(readLevel(-0.5)).toBe(0)
    expect(readLevel(undefined)).toBe(0)
    expect(readLevel('0.5')).toBe(0)
    expect(readLevel(Number.NaN)).toBe(0)
  })
})

describe('readSelected', () => {
  it('passes through numbers and strings, defaulting to 0', () => {
    expect(readSelected(3)).toBe(3)
    expect(readSelected('a')).toBe('a')
    expect(readSelected(undefined)).toBe(0)
    expect(readSelected(true)).toBe(0)
  })
})

describe('selectOptions', () => {
  const binding: SelectWidgetBinding = {
    kind: 'select',
    command: 'setInput',
    paramKey: 'input',
    stateKey: 'input',
    optionsKey: 'options',
    options: [{ value: 0, label: 'Static fallback' }],
  }

  it('prefers the dynamic state-driven list when present', () => {
    const state = { options: [{ value: 1, label: 'Lectern' }] }
    expect(selectOptions(binding, state)).toEqual([{ value: 1, label: 'Lectern' }])
  })

  it('falls back to the manifest-declared static options when state has none', () => {
    expect(selectOptions(binding, {})).toEqual([{ value: 0, label: 'Static fallback' }])
    expect(selectOptions(binding, undefined)).toEqual([{ value: 0, label: 'Static fallback' }])
  })

  it('returns an empty list when neither is present', () => {
    const bare: SelectWidgetBinding = { kind: 'select', command: 'setInput', paramKey: 'input', stateKey: 'input' }
    expect(selectOptions(bare, {})).toEqual([])
  })

  // A matrix switcher's input labels are static per-connection, so they should
  // be readable without any live device state at all — this is the fix for
  // "select shows no options until the driver has connected at least once".
  describe('connectionOptions (static, read from the connection, no live state needed)', () => {
    const matrixBinding: SelectWidgetBinding = {
      kind: 'select',
      command: 'setInput',
      paramKey: 'input',
      stateKey: 'input',
      connectionOptions: { labelsKey: 'inputs', countKey: 'inputCount', fallbackLabel: 'Input', includeNone: true },
    }

    it('builds None + numbered options from connection config, with no live state', () => {
      const config = { inputCount: 3, inputs: ['Lectern', 'Laptop'] }
      expect(selectOptions(matrixBinding, undefined, config)).toEqual([
        { value: 0, label: 'None' },
        { value: 1, label: '1. Lectern' },
        { value: 2, label: '2. Laptop' },
        { value: 3, label: 'Input 3' }, // unlabeled input falls back
      ])
    })

    it('omits the None entry when includeNone is not set', () => {
      const binding: SelectWidgetBinding = { ...matrixBinding, connectionOptions: { ...matrixBinding.connectionOptions!, includeNone: false } }
      expect(selectOptions(binding, undefined, { inputCount: 1, inputs: ['Lectern'] })).toEqual([
        { value: 1, label: '1. Lectern' },
      ])
    })

    it('takes priority over optionsKey/options when both are present', () => {
      const binding: SelectWidgetBinding = {
        ...matrixBinding,
        optionsKey: 'options',
        options: [{ value: 9, label: 'Should not win' }],
      }
      const state = { options: [{ value: 8, label: 'Should also not win' }] }
      expect(selectOptions(binding, state, { inputCount: 1, inputs: ['Lectern'] })).toEqual([
        { value: 0, label: 'None' },
        { value: 1, label: '1. Lectern' },
      ])
    })

    it('falls back to optionsKey/options when the connection config has no valid count', () => {
      expect(selectOptions(matrixBinding, undefined, {})).toEqual([])
      expect(selectOptions(matrixBinding, undefined, { inputCount: 0, inputs: ['Lectern'] })).toEqual([])
    })
  })
})

describe('buttonsFor', () => {
  it('splits each entry into its label and the rest as command params', () => {
    const device = {
      address: {
        buttons: [
          { label: 'Go', address: '/go' },
          { label: 'Level 80%', address: '/cue/1/level', args: '0.8' },
        ],
      },
    }
    expect(buttonsFor(device)).toEqual([
      { label: 'Go', params: { address: '/go' } },
      { label: 'Level 80%', params: { address: '/cue/1/level', args: '0.8' } },
    ])
  })

  it('two devices sharing one connection can have entirely different buttons', () => {
    const jingles = { address: { buttons: [{ label: 'Fanfare', payload: '/jingle/1' }] } }
    const alarms = { address: { buttons: [{ label: 'Fire', payload: '/alarm/fire' }, { label: 'Evac', payload: '/alarm/evac' }] } }
    expect(buttonsFor(jingles)).toEqual([{ label: 'Fanfare', params: { payload: '/jingle/1' } }])
    expect(buttonsFor(alarms)).toEqual([
      { label: 'Fire', params: { payload: '/alarm/fire' } },
      { label: 'Evac', params: { payload: '/alarm/evac' } },
    ])
  })

  it('returns an empty list when buttons is missing or not an array', () => {
    expect(buttonsFor({ address: {} })).toEqual([])
    expect(buttonsFor({ address: { buttons: 'nope' } })).toEqual([])
  })

  it('skips malformed entries (no label, or not an object) instead of throwing', () => {
    const device = {
      address: {
        buttons: [
          { label: 'Good', payload: 'x' },
          { payload: 'no label' },
          { label: '', payload: 'blank label' },
          'not an object',
          null,
        ],
      },
    }
    expect(buttonsFor(device)).toEqual([{ label: 'Good', params: { payload: 'x' } }])
  })
})
