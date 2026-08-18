/**
 * Device provisioning logic — turning connections that carry no endpoint yet
 * into the devices an operator almost certainly meant to create.
 *
 * A hundred TVs is a hundred connections *and* a hundred devices, and the
 * second hundred is pure bookkeeping: for a driver wired one-box-per-connection
 * (`DriverManifest.soloEndpointType` — a projector, a display on its own IP)
 * there is exactly one endpoint per socket, its type is named in the manifest
 * and its address is entirely defaults. Nothing about that needs a human, so
 * the UI offers to write all of it at once instead of making someone open the
 * New-device dialog a hundred times.
 *
 * Everything here is pure so the fiddly parts (which connections qualify, how a
 * room is guessed out of a name, what the batch finally posts) are testable
 * without mounting a dialog — see `__tests__/deviceProvisioning.spec.ts`.
 *
 * Two things are deliberately *not* provisioned:
 *
 *  - **Gateway drivers** (a DALI bus, an Extron matrix, a BSS DSP). One
 *    connection genuinely fans out to many endpoints, and how many — and at
 *    which addresses — is a question about the physical bus, not about the
 *    database. Those rows are listed but blocked, pointing at the sheet.
 *  - **Endpoints whose address can't be defaulted.** A required address
 *    property with no `default` is a value only the installer knows; guessing
 *    it would create a device that talks to the wrong hardware.
 *
 * The batch itself goes out over the existing `POST /api/v1/bulk/devices`
 * (`lib/api.ts` → `api.bulk.applyDevices`), which already validates every row
 * against the driver manifests and writes all-or-nothing — the same guarantee
 * the spreadsheet editor relies on.
 */

import type { DriverManifest, EndpointTypeDefinition, JsonSchema } from '@gallery/driver-core'
import type { BulkDeviceRowInput, ConnectionStatus, DeviceDTO, RoomDTO } from '@gallery/types'
import type { ConnectionRecord } from './connections'
import { normalize } from './text'

/** Why a connection can't be provisioned in one click. */
export type ProvisionBlockReason = 'no-driver' | 'gateway' | 'addressing'

/** Short badge text for each blocking reason — shown on the skipped row. */
export const BLOCK_LABEL: Record<ProvisionBlockReason, string> = {
  'no-driver': 'Driver not installed',
  gateway: 'Endpoints addressed individually',
  addressing: 'Addressing needed first',
}

/** The longer explanation, for the row's title attribute. */
export const BLOCK_HINT: Record<ProvisionBlockReason, string> = {
  'no-driver': "This connection's driver isn't installed, so its endpoints are unknown.",
  gateway:
    'A gateway fans out to many endpoints — how many, and at which addresses, is a question ' +
    'about the bus. Add them in the Sheet.',
  addressing:
    'This endpoint type needs an address value that has no default — only the installer knows it.',
}

/** One connection considered for provisioning, with everything the review sheet renders. */
export interface ProvisionCandidate {
  connectionId: string
  connectionName: string
  driverId: string
  /** Manifest name, or the raw driver id when the driver isn't installed. */
  driverName: string
  /** `192.168.0.20:5000`, or the connection name when it has no host. */
  endpoint: string
  /** Endpoint type the device would be created as (absent when blocked). */
  subtype?: string
  /** The `devices.type` category, inferred from the driver (see `deviceTypeOf`). */
  deviceType: string
  /** Pre-filled device name — the connection's own name. */
  suggestedName: string
  /** Room guessed from the connection name, or `null` when nothing matched. */
  guessedRoomId: string | null
  /** Set when the connection can't be provisioned in one click. */
  blocked?: ProvisionBlockReason
  /** Live socket state — an offline connection is listed but not pre-selected. */
  online: boolean
  /** ISO timestamp behind the "Offline since …" badge, when Redis has one. */
  lastSeen?: string
}

/** Candidates for one driver, as the review sheet groups them. */
export interface ProvisionGroup {
  driverId: string
  driverName: string
  /** `display driver` / `lighting bus` — how the group's hardware is wired. */
  kindLabel: string
  candidates: ProvisionCandidate[]
}

/** One row of the review sheet: a candidate plus the operator's edits to it. */
export interface ProvisionRow {
  connectionId: string
  selected: boolean
  name: string
  roomId: string | null
}

// ── driver classification ───────────────────────────────────────────────────

/**
 * Keyword → device category. The manifest has no category field (a driver
 * describes how to *talk* to hardware, not what the hardware is for), so the
 * category the operator would have picked in the New-device dialog is inferred
 * from the driver and endpoint-type names. It's only the pre-filled `type`
 * column — wrong guesses are one edit away in the devices list, and `custom`
 * is a safe last resort.
 */
const TYPE_KEYWORDS: Array<[RegExp, string]> = [
  [/blind|shade|curtain|roller/, 'blind'],
  [/dali|light|lumin|dmx|foxtron|lunatone/, 'lighting'],
  [/matrix|switcher|crosspoint|extron/, 'matrix'],
  [/mic\b|microphone/, 'microphone'],
  [/projector|pjlink/, 'video'],
  [/display|monitor|screen|\btv\b|prolite|mdc/, 'display'],
  [/socket|outlet|pdu|netio|relay|power/, 'power'],
  [/fader|audio|dsp|soundweb|mixer|bss/, 'audio'],
]

/**
 * The `devices.type` a provisioned endpoint gets.
 *
 * @returns One of `DEVICE_TYPES`, defaulting to `custom` when nothing matches.
 */
export function deviceTypeOf(
  manifest: DriverManifest | undefined,
  endpointType: EndpointTypeDefinition | undefined,
): string {
  const haystack = normalize(
    [manifest?.id, manifest?.name, manifest?.vendor, endpointType?.type, endpointType?.name]
      .filter(Boolean)
      .join(' '),
  )
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(haystack)) return type
  }
  return 'custom'
}

/** Every required address property this endpoint type can fill from a `default`. */
function addressIsDefaultable(endpointType: EndpointTypeDefinition | undefined): boolean {
  if (!endpointType) return false
  const schema = endpointType.addressSchema
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  return (schema.required ?? []).every((key) => properties[key]?.default !== undefined)
}

/**
 * Why (if at all) a connection can't be turned into a device unattended.
 *
 * @returns The blocking reason, or `undefined` when one click is enough.
 */
export function blockReasonOf(
  manifest: DriverManifest | undefined,
): ProvisionBlockReason | undefined {
  if (!manifest) return 'no-driver'
  if (!manifest.soloEndpointType) return 'gateway'
  const endpointType = manifest.endpointTypes.find((e) => e.type === manifest.soloEndpointType)
  if (!endpointType) return 'no-driver'
  return addressIsDefaultable(endpointType) ? undefined : 'addressing'
}

// ── room guessing ───────────────────────────────────────────────────────────

/**
 * Guess which room a connection belongs to from its name.
 *
 * Integrators name sockets after where they hang ("Iiyama Display Hall 1
 * Left"), so the room is usually already written down — matching it saves the
 * operator assigning a hundred rooms by hand. Longest room name wins, so
 * "Hall 1" beats "Hall" on a name that contains both, and the match is
 * diacritic-insensitive (`normalize`) because "Sál" and "Sal" are the same room.
 *
 * @returns The matching room's id, or `null` when no room name occurs in `name`.
 */
export function guessRoomId(name: string, rooms: RoomDTO[]): string | null {
  const haystack = normalize(name)
  let best: RoomDTO | null = null
  for (const room of rooms) {
    const needle = normalize(room.name)
    if (!needle || !haystack.includes(needle)) continue
    if (!best || needle.length > normalize(best.name).length) best = room
  }
  return best?.id ?? null
}

// ── candidates ──────────────────────────────────────────────────────────────

/** `192.168.0.20:5000`, falling back to the host alone, then the name. */
export function endpointLabel(connection: ConnectionRecord): string {
  if (!connection.host) return connection.name
  return connection.port ? `${connection.host}:${connection.port}` : connection.host
}

/** Connections that no device hangs off yet — the whole population this offers to fill in. */
export function connectionsWithoutDevices(
  connections: ConnectionRecord[],
  devices: Pick<DeviceDTO, 'connectionId'>[],
): ConnectionRecord[] {
  const used = new Set(devices.map((device) => device.connectionId))
  return connections.filter((connection) => !used.has(connection.id))
}

/**
 * Build one review row per device-less connection.
 *
 * Sorted by name (numeric-aware, so `Display 2` precedes `Display 10`) because
 * that's the order the racks were named in, and a review sheet is read top to
 * bottom.
 */
export function buildCandidates(
  connections: ConnectionRecord[],
  devices: Pick<DeviceDTO, 'connectionId'>[],
  manifestOf: (driverId: string) => DriverManifest | undefined,
  rooms: RoomDTO[],
  statusOf: (connectionId: string) => ConnectionStatus | undefined = () => undefined,
): ProvisionCandidate[] {
  return connectionsWithoutDevices(connections, devices)
    .map((connection) => {
      const manifest = manifestOf(connection.driverId)
      const blocked = blockReasonOf(manifest)
      const endpointType = manifest?.endpointTypes.find((e) => e.type === manifest.soloEndpointType)
      const status = statusOf(connection.id)
      return {
        connectionId: connection.id,
        connectionName: connection.name,
        driverId: connection.driverId,
        driverName: manifest?.name ?? connection.driverId,
        endpoint: endpointLabel(connection),
        subtype: blocked ? undefined : endpointType?.type,
        deviceType: deviceTypeOf(manifest, endpointType),
        suggestedName: connection.name,
        guessedRoomId: guessRoomId(connection.name, rooms),
        blocked,
        online: status?.online ?? false,
        lastSeen: status?.lastSeen,
      }
    })
    .sort((a, b) => a.connectionName.localeCompare(b.connectionName, undefined, { numeric: true }))
}

/** How a group's hardware is wired: `display driver` for 1:1, `lighting bus` for a gateway. */
function kindLabelOf(candidate: ProvisionCandidate | undefined): string {
  return `${candidate?.deviceType ?? 'custom'} ${candidate?.blocked === 'gateway' ? 'bus' : 'driver'}`
}

/**
 * Group candidates by driver, blocked drivers last.
 *
 * Grouping is what makes a hundred rows reviewable: identical hardware reads as
 * one block an operator can accept or skip wholesale, instead of a hundred
 * individual decisions.
 */
export function groupCandidates(candidates: ProvisionCandidate[]): ProvisionGroup[] {
  const groups = new Map<string, ProvisionGroup>()
  for (const candidate of candidates) {
    let group = groups.get(candidate.driverId)
    if (!group) {
      group = {
        driverId: candidate.driverId,
        driverName: candidate.driverName,
        kindLabel: '',
        candidates: [],
      }
      groups.set(candidate.driverId, group)
    }
    group.candidates.push(candidate)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      // Every candidate in a group shares a driver, so the first one's
      // classification describes the whole group: a 1:1 driver reads as a
      // "display driver", a gateway as a "lighting bus".
      kindLabel: kindLabelOf(group.candidates[0]),
    }))
    .sort((a, b) => {
      const blockedA = a.candidates.every((candidate) => candidate.blocked) ? 1 : 0
      const blockedB = b.candidates.every((candidate) => candidate.blocked) ? 1 : 0
      return blockedA - blockedB || a.driverName.localeCompare(b.driverName)
    })
}

/**
 * Naive English plural of a driver name — "Display" → "Displays", "Matrix" →
 * "Matrixes". Good enough for a one-line count, and better than the alternative
 * of reading "6 Iiyama ProLite Display".
 */
function pluralize(name: string, count: number): string {
  if (count === 1) return name
  return /(s|x|z|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`
}

/**
 * One-line summary of what's waiting — the nudge's subtitle.
 *
 * @returns e.g. `6 Iiyama ProLite Displays, 2 Samsung MDC Displays, 1 Foxtron Gateway`
 */
export function summarizeCandidates(candidates: ProvisionCandidate[]): string {
  return groupCandidates(candidates)
    .map(
      (group) =>
        `${group.candidates.length} ${pluralize(group.driverName, group.candidates.length)}`,
    )
    .join(', ')
}

// ── rows → payload ──────────────────────────────────────────────────────────

/**
 * The initial edit state for a candidate list.
 *
 * A blocked candidate is never selected. Offline ones are the interesting case,
 * and being offline means different things depending on the company it keeps:
 *
 *  - **Some connections are answering.** The silent ones are then the anomaly —
 *    probably miswired, mistyped or decommissioned — so they start unselected
 *    rather than quietly adding a permanently-red tile to everyone's panel.
 *  - **Nothing is answering at all.** Being offline now carries no information:
 *    this is a system configured before the hardware is on the network, which
 *    is the normal order of work on a commissioning job. Deselecting everything
 *    there would offer the operator a sheet that creates nothing, so every
 *    provisionable row starts selected instead.
 *
 * Either way it's only a default. The offline badge stays on the row, so the
 * operator can see exactly what they're accepting and uncheck it.
 */
export function initialRows(candidates: ProvisionCandidate[]): ProvisionRow[] {
  const anyOnline = candidates.some((candidate) => !candidate.blocked && candidate.online)
  return candidates.map((candidate) => ({
    connectionId: candidate.connectionId,
    selected: !candidate.blocked && (candidate.online || !anyOnline),
    name: candidate.suggestedName,
    roomId: candidate.guessedRoomId,
  }))
}

/** A row may only be posted when its candidate isn't blocked and it has a name. */
export function isRowValid(row: ProvisionRow, candidate: ProvisionCandidate | undefined): boolean {
  return !!candidate && !candidate.blocked && row.name.trim().length > 0
}

/**
 * Turn the reviewed rows into a `POST /api/v1/bulk/devices` body.
 *
 * Only `connectionId`, name, type and room travel: the server derives the
 * endpoint type from the driver's `soloEndpointType`, fills the address from
 * the schema defaults and projects capabilities off the endpoint's commands —
 * exactly as the spreadsheet editor's rows do, so there is one server-side
 * definition of what a valid device is, not two.
 */
export function buildProvisionPayload(
  rows: ProvisionRow[],
  candidates: ProvisionCandidate[],
): BulkDeviceRowInput[] {
  const byId = new Map(candidates.map((candidate) => [candidate.connectionId, candidate]))
  return rows
    .filter((row) => row.selected && isRowValid(row, byId.get(row.connectionId)))
    .map((row) => ({
      connectionId: row.connectionId,
      name: row.name.trim(),
      type: byId.get(row.connectionId)?.deviceType ?? 'custom',
      roomId: row.roomId,
    }))
}
