/**
 * Quick keyboard actions for a device, derived from its `capabilities`.
 *
 * These power the command palette: param-less or simple commands a user can fire
 * with one keypress (Turn on/off, Mute, level presets…). Commands that need rich
 * input (setInput, recall, send) are intentionally omitted. The `command` /
 * `params` / `optimistic` shapes mirror what the device widgets send, so palette
 * actions behave identically to the on-screen controls.
 */

import { type DeviceRecord, type DeviceState } from './devices'

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

export function deviceActions(device: DeviceRecord): DeviceAction[] {
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

  return actions
}
