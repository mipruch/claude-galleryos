import { describe, it, expect } from 'vitest'
import type { SelectWidgetBinding } from '@gallery/driver-core'
import {
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
})
