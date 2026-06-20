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
import { matchesAllTerms, normalize, searchTerms } from './text'

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
    if (v === true) return true
    if (typeof v === 'string') return v === 'on'
    // boolean false: keep looking — a later key may carry an authoritative "on"
  }
  return false
}

// ── optimistic-update helpers (snapshot + revert for command rollback) ───────

/** Capture the pre-patch values of the keys a patch will touch (absent → undefined). */
export function snapshotState(current: DeviceState, patch: DeviceState): DeviceState {
  const previous: DeviceState = {}
  for (const key of Object.keys(patch)) previous[key] = current[key]
  return previous
}

/** Restore snapshotted keys onto a copy of `current`, deleting those absent before. */
export function applyRevert(current: DeviceState, previous: DeviceState): DeviceState {
  const next = { ...current }
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return next
}

// ── grouping & filtering (pure helpers, used by the store + toolbar) ─────────

/** How the device grid is partitioned. */
export type GroupMode = 'off' | 'room' | 'type'

/** A leaf partition of devices (the inner level / a single grid). */
export interface DeviceSubgroup {
  key: string
  title: string | null
  devices: DeviceRecord[]
}

/**
 * A titled partition of devices, itself split into subgroups. Both `title` and
 * each subgroup `title` are null for the ungrouped ("off") view. When grouping by
 * room the subgroups are types (and vice-versa). Empty groups/subgroups are never
 * produced — they only contain devices that are actually present.
 */
export interface DeviceGroup {
  key: string
  title: string | null
  subgroups: DeviceSubgroup[]
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

/** Keep only devices in the selected rooms (by `roomKey`); empty means "all". */
export function filterByRooms(devices: DeviceRecord[], roomKeys: string[]): DeviceRecord[] {
  if (!roomKeys.length) return devices
  const allow = new Set(roomKeys)
  return devices.filter((d) => allow.has(roomKeyOf(d)))
}

/** All human-readable text a device can be matched on, normalized. */
function deviceHaystack(device: DeviceRecord, roomName: string | undefined): string {
  return normalize(
    [
      device.name,
      device.description ?? '',
      roomName ?? '',
      device.type,
      typeLabel(device.type),
      device.subtype ?? '',
    ].join(' '),
  )
}

/**
 * Loose, multi-field search across name, description, room, type and subtype.
 * Case- and accent-insensitive; every whitespace-separated term must appear
 * somewhere (AND), so "hall light" matches a light in the Hall. An empty query
 * returns the input unchanged.
 */
export function searchDevices(
  devices: DeviceRecord[],
  query: string,
  rooms: RoomDTO[],
): DeviceRecord[] {
  const terms = searchTerms(query)
  if (!terms.length) return devices
  const roomName = new Map(rooms.map((r) => [r.id, r.name]))
  return devices.filter((d) =>
    matchesAllTerms(deviceHaystack(d, d.roomId ? roomName.get(d.roomId) : undefined), terms),
  )
}

/** A room available to filter on, with its device count. */
export interface RoomOption {
  /** Room id, or the sentinel for room-less devices. */
  key: string
  name: string
  count: number
}

/** Rooms that actually have devices, ordered by `displayOrder` then name (unassigned last). */
export function roomOptionsOf(devices: DeviceRecord[], rooms: RoomDTO[]): RoomOption[] {
  const byId = new Map(rooms.map((r) => [r.id, r]))
  return collect(devices, roomKeyOf)
    .map((g) => {
      const room = byId.get(g.key)
      return {
        key: g.key,
        name: room?.name ?? 'Unassigned',
        order: room?.displayOrder ?? Number.MAX_SAFE_INTEGER,
        count: g.items.length,
      }
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ key, name, count }) => ({ key, name, count }))
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

/** Sentinel room key for devices/scenes with no `roomId`. Shared with the scene helpers. */
export const ROOM_UNASSIGNED = '__unassigned__'
const UNASSIGNED = ROOM_UNASSIGNED
const roomKeyOf = (d: DeviceRecord): string => d.roomId ?? UNASSIGNED

/** Subgroups by device type, alphabetical. */
function byType(devices: DeviceRecord[]): DeviceSubgroup[] {
  return collect(devices, (d) => d.type)
    .map((g) => ({ key: g.key, title: typeLabel(g.key), devices: g.items }))
    .sort((a, b) => a.title!.localeCompare(b.title!))
}

/** Subgroups by room, ordered by the room's `displayOrder` (then name), unassigned last. */
function byRoom(devices: DeviceRecord[], rooms: RoomDTO[]): DeviceSubgroup[] {
  const byId = new Map(rooms.map((r) => [r.id, r]))
  return collect(devices, roomKeyOf)
    .map((g) => {
      const room = byId.get(g.key)
      return {
        key: g.key,
        title: room?.name ?? 'Unassigned',
        order: room?.displayOrder ?? Number.MAX_SAFE_INTEGER,
        devices: g.items,
      }
    })
    .sort((a, b) => a.order - b.order || a.title!.localeCompare(b.title!))
    .map(({ key, title, devices }) => ({ key, title, devices }))
}

/**
 * Partition devices into (optionally nested) display groups:
 *   - `off`  → one untitled group with one untitled subgroup (a plain grid).
 *   - `room` → grouped by room, each room subgrouped by type.
 *   - `type` → grouped by type, each type subgrouped by room.
 *
 * Groups and subgroups are only produced for keys that actually have devices, so
 * empty (sub)groups never render.
 */
export function groupDevices(
  devices: DeviceRecord[],
  mode: GroupMode,
  rooms: RoomDTO[],
): DeviceGroup[] {
  if (mode === 'off') {
    return [{ key: 'all', title: null, subgroups: [{ key: 'all', title: null, devices }] }]
  }

  if (mode === 'type') {
    return byType(devices).map((g) => ({
      key: g.key,
      title: g.title,
      subgroups: byRoom(g.devices, rooms),
    }))
  }

  // mode === 'room'
  return byRoom(devices, rooms).map((g) => ({
    key: g.key,
    title: g.title,
    subgroups: byType(g.devices),
  }))
}
