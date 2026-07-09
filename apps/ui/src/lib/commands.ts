/**
 * Quick keyboard actions for a device, derived from its `capabilities` plus
 * (for an enumerated choice) its resolved `select` widget binding.
 *
 * These power the command palette: param-less or simple commands a user can fire
 * with one keypress (Turn on/off, Mute, level presets, a matrix input…). Commands
 * that need free-form input (recall, send) are intentionally omitted. The
 * `command` / `params` / `optimistic` shapes mirror what the device widgets send,
 * so palette actions behave identically to the on-screen controls — and, same as
 * the widgets, this stays driver-agnostic: no subtype ever appears here.
 */

import type { WidgetBinding } from '@gallery/driver-core'
import { type DeviceRecord, type DeviceState } from './devices'
import { selectOptions } from './widgets'

export interface DeviceAction {
  /** Stable id within a device (used as the list key). */
  id: string
  label: string
  command: string
  params: Record<string, unknown>
  /** Optimistic state patch applied immediately, matching the widgets. */
  optimistic?: DeviceState
}

/** Level presets offered for dimmer/fader capabilities. */
const LEVEL_PRESETS = [100, 50, 0] as const

export function deviceActions(
  device: DeviceRecord,
  state: DeviceState,
  widgets: WidgetBinding[],
): DeviceAction[] {
  const caps = new Set(device.capabilities)
  const actions: DeviceAction[] = []

  if (caps.has('on')) {
    actions.push({ id: 'on', label: 'Turn on', command: 'on', params: {}, optimistic: { on: true, power: 'on' } })
  }
  if (caps.has('off')) {
    actions.push({ id: 'off', label: 'Turn off', command: 'off', params: {}, optimistic: { on: false, power: 'off' } })
  }
  if (caps.has('toggle')) {
    actions.push({ id: 'toggle', label: 'Toggle', command: 'toggle', params: {} })
  }
  if (caps.has('setMute')) {
    actions.push({ id: 'mute', label: 'Mute', command: 'setMute', params: { muted: true }, optimistic: { muted: true } })
    actions.push({ id: 'unmute', label: 'Unmute', command: 'setMute', params: { muted: false }, optimistic: { muted: false } })
  }
  // Dimmers/faders: setBrightness stores under `brightness`, setLevel under
  // `level` (matches each widget's optimistic key).
  for (const [cap, stateKey] of [['setBrightness', 'brightness'], ['setLevel', 'level']] as const) {
    if (!caps.has(cap)) continue
    for (const pct of LEVEL_PRESETS) {
      const level = pct / 100
      actions.push({
        id: `${cap}-${pct}`,
        label: `Set ${pct}%`,
        command: cap,
        params: { level },
        optimistic: { [stateKey]: level },
      })
    }
  }
  if (caps.has('shortOn')) {
    actions.push({ id: 'shortOn', label: 'Pulse on', command: 'shortOn', params: {} })
  }
  if (caps.has('shortOff')) {
    actions.push({ id: 'shortOff', label: 'Pulse off', command: 'shortOff', params: {} })
  }

  // A select-kind widget (e.g. a matrix output's input picker): one quick
  // action per available option. Generic — works for any driver's select
  // widget, not just a matrix.
  const select = widgets.find((w): w is Extract<WidgetBinding, { kind: 'select' }> => w.kind === 'select')
  if (select) {
    for (const option of selectOptions(select, state)) {
      actions.push({
        id: `${select.command}-${option.value}`,
        label: option.label,
        command: select.command,
        params: { [select.paramKey]: option.value },
        optimistic: { [select.stateKey]: option.value },
      })
    }
  }

  return actions
}
