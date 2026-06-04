/**
 * Device domain helpers shared by the store and the widgets.
 *
 * The record and live-state *types* come from the shared `@gallery/types`
 * package (single source of truth, derived from the Drizzle schema): a
 * `DeviceRecord` is the serialized row returned by `GET /api/v1/devices`, while
 * the live values (fader level, mute, on/off) live separately in `DeviceState`,
 * hydrated from Redis on load and kept fresh by WebSocket `device:state` pushes.
 */

import type { DeviceDTO as DeviceRecord, DeviceState, RoomDTO } from '@gallery/types'

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

// ── grouping & filtering (pure helpers, used by the store + toolbar) ─────────

/** How the device grid is partitioned. */
export type GroupMode = 'off' | 'room' | 'type'

/** A titled partition of devices. `title` is null for the ungrouped ("off") view. */
export interface DeviceGroup {
  key: string
  title: string | null
  devices: DeviceRecord[]
}

/** Friendlier labels for the known device `type` values; falls back to Capitalised. */
const TYPE_LABELS: Record<string, string> = {
  light: 'Lights',
  lighting: 'Lights',
  audio: 'Audio',
  microphone: 'Microphones',
  video: 'Video',
  display: 'Displays',
  matrix: 'Matrix',
  blind: 'Blinds',
  power: 'Power',
  custom: 'Custom',
}

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

/** Distinct device types present, sorted alphabetically. */
export function deviceTypesOf(devices: DeviceRecord[]): string[] {
  return [...new Set(devices.map((d) => d.type))].sort()
}

/** Keep only devices whose type is selected; an empty selection means "all". */
export function filterByTypes(devices: DeviceRecord[], types: string[]): DeviceRecord[] {
  if (!types.length) return devices
  const allow = new Set(types)
  return devices.filter((d) => allow.has(d.type))
}

/** Group items by a derived key, preserving first-seen order within each group. */
function collect<T>(items: T[], keyOf: (item: T) => string): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }))
}

const UNASSIGNED = '__unassigned__'

/**
 * Partition devices for display. `off` → one untitled group (input order
 * preserved); `type` → grouped by device type, alphabetical; `room` → grouped by
 * room, ordered by the room's `displayOrder` (then name), with unassigned last.
 */
export function groupDevices(
  devices: DeviceRecord[],
  mode: GroupMode,
  rooms: RoomDTO[],
): DeviceGroup[] {
  if (mode === 'off') return [{ key: 'all', title: null, devices }]

  if (mode === 'type') {
    return collect(devices, (d) => d.type)
      .map((g) => ({ key: g.key, title: typeLabel(g.key), devices: g.items }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  // mode === 'room'
  const byId = new Map(rooms.map((r) => [r.id, r]))
  return collect(devices, (d) => d.roomId ?? UNASSIGNED)
    .map((g) => {
      const room = byId.get(g.key)
      return {
        key: g.key,
        title: room?.name ?? 'Unassigned',
        order: room?.displayOrder ?? Number.MAX_SAFE_INTEGER,
        devices: g.items,
      }
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    .map(({ key, title, devices }) => ({ key, title, devices }))
}
