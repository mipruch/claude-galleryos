/**
 * Device domain helpers shared by the store and the widgets.
 *
 * The record and live-state *types* come from the shared `@gallery/types`
 * package (single source of truth, derived from the Drizzle schema): a
 * `DeviceRecord` is the serialized row returned by `GET /api/v1/devices`, while
 * the live values (fader level, mute, on/off) live separately in `DeviceState`,
 * hydrated from Redis on load and kept fresh by WebSocket `device:state` pushes.
 */

import type { DeviceDTO as DeviceRecord, DeviceState } from '@gallery/types'

// Re-exported under the UI's historical names so widgets keep importing from
// `@/lib/devices`. `DeviceDTO` is the JSON-wire shape of a `devices` row.
export type { DeviceDTO as DeviceRecord, DeviceState, DeviceStatus } from '@gallery/types'

/**
 * Which control widget a device maps to. Derived from the driver endpoint
 * type (`subtype`). Adding a new driver = one line here.
 */
export type DeviceKind = 'lightFader' | 'bssFader' | 'bssMatrix' | 'switch' | 'unsupported'

export function deviceKind(device: DeviceRecord): DeviceKind {
  switch (device.subtype) {
    case 'bss-soundweb.fader':
      // Matrix routing cross-points share the same driver endpoint but use
      // power (on/off) semantics instead of audio mute. Detect via either the
      // dedicated subtype *or* the device's generic type field so existing
      // devices don't need a subtype change — just set type='matrix' in the DB.
      return device.type === 'matrix' ? 'bssMatrix' : 'bssFader'
    case 'bss-soundweb.matrix':
      return 'bssMatrix'
    case 'dali.fixture':
    case 'dali-foxtron.fixture':
      return 'lightFader'
    case 'netio.socket':
    case 'pjlink.projector':
      return 'switch'
    default:
      return 'unsupported'
  }
}

// ── live-value readers (tolerant of missing / partial state) ────────────────

/** Read a 0..1 fader/brightness value, defaulting to 0. */
export function readLevel(state: DeviceState | undefined, ...keys: string[]): number {
  for (const key of keys) {
    const v = state?.[key]
    if (typeof v === 'number' && Number.isFinite(v)) return Math.min(1, Math.max(0, v))
  }
  return 0
}

/** Read a boolean on/off value. Tolerates PJLink's string `power` ("on"/"off"). */
export function readOn(state: DeviceState | undefined, ...keys: string[]): boolean {
  for (const key of keys) {
    const v = state?.[key]
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') return v === 'on'
  }
  return false
}
