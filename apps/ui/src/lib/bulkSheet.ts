/**
 * Spreadsheet-editor logic — everything the bulk device grid does that isn't
 * rendering: what its columns are, how a cell's text becomes a typed value,
 * how a clipboard payload from Google Sheets is parsed, how a series is
 * continued down a column, and how the edited rows become a
 * `POST /api/v1/bulk/devices` body.
 *
 * It lives outside the component so the fiddly parts (TSV quoting, series
 * inference, dirty-row diffing) are unit-testable without mounting a grid —
 * see `__tests__/bulkSheet.spec.ts`.
 *
 * Two shapes of sheet, decided by the driver's manifest:
 *
 *  - **unit** — the driver declares `soloEndpointType` (a projector, a Samsung
 *    display on its own IP). One row *is* one physical box: it carries the
 *    connection's columns (host, port, …) and the device's, and saving writes
 *    both records. This is the "unify the 1:1 devices" case — the operator
 *    never sees, names, or counts connections.
 *  - **endpoint** — a gateway driver (DALI bus, Extron matrix, BSS DSP). The
 *    connection is picked once above the grid and every row is just an endpoint
 *    on it, so the columns are the address plus the device fields.
 *
 * Column keys are the same dotted paths the server addresses its validation
 * errors with (`name`, `connection.host`, `address.displayId`), which is what
 * lets a rejected batch paint the exact offending cell red.
 */

import type { DriverManifest, EndpointTypeDefinition, JsonSchema } from '@gallery/driver-core'
import type { BulkDeviceRowInput, ConnectionDTO, DeviceDTO, RoomDTO } from '@gallery/types'
import { DEVICE_TYPES } from './devices'

/** Everything a sheet cell can hold. `null` is an empty cell. */
export type SheetValue = string | number | boolean | null

export type SheetColumnKind = 'text' | 'number' | 'boolean' | 'select'

/** Which record a column writes to — decides where its value lands in the bulk payload. */
export type SheetColumnScope = 'device' | 'connection' | 'address'

export interface SheetSelectOption {
  value: string
  label: string
}

/** One column of the grid: how to render it, validate it, and where it goes. */
export interface SheetColumn {
  /** Dotted path, matching the server's error `field` values. */
  key: string
  /** Property name within its scope (`host`, `displayId`, `roomId`). */
  field: string
  scope: SheetColumnScope
  label: string
  kind: SheetColumnKind
  description?: string
  required?: boolean
  /**
   * Required only while this other column is empty — the two name columns lean
   * on each other (fill either one and the row is valid; whichever is blank
   * takes the other's value on save).
   */
  requiredUnless?: string
  min?: number
  max?: number
  options?: SheetSelectOption[]
  /** Seed for a freshly added row when there's no earlier row to continue from. */
  fallback: SheetValue
  /**
   * Hidden until the operator turns it on. Used for connection settings that
   * have a sensible manifest default (timeouts, delimiters) — real columns,
   * just not ones worth 64 rows of screen width.
   */
  advanced?: boolean
}

/** One row of the grid — a device, and in `unit` mode the connection under it. */
export interface SheetRow {
  /** Stable client key: the device id for saved rows, `new:N` for added ones. */
  key: string
  deviceId?: string
  connectionId?: string
  values: Record<string, SheetValue>
}

export type SheetMode = 'unit' | 'endpoint'

/** A cell coordinate within the grid. */
export interface CellRef {
  row: number
  col: number
}

/** An inclusive rectangle of cells, normalised so start <= end on both axes. */
export interface CellRange {
  top: number
  left: number
  bottom: number
  right: number
}

/** The mode a driver's sheet runs in: 1:1 rows, or endpoints on one gateway. */
export function sheetModeOf(manifest: DriverManifest | undefined): SheetMode {
  return manifest?.soloEndpointType ? 'unit' : 'endpoint'
}

/**
 * The endpoint type a sheet edits: the driver's declared 1:1 type, else the
 * explicit choice, else the driver's only type.
 */
export function resolveEndpointType(
  manifest: DriverManifest | undefined,
  chosen?: string,
): EndpointTypeDefinition | undefined {
  if (!manifest) return undefined
  const wanted = manifest.soloEndpointType ?? chosen
  if (wanted) return manifest.endpointTypes.find((e) => e.type === wanted)
  return manifest.endpointTypes.length === 1 ? manifest.endpointTypes[0] : undefined
}

/** Scalar JSON-Schema properties become columns; arrays/objects don't fit a cell. */
function scalarProperties(schema: JsonSchema | undefined): [string, JsonSchema][] {
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>
  return Object.entries(properties).filter(
    ([, property]) => property.type !== 'array' && property.type !== 'object',
  )
}

function columnFromSchema(
  key: string,
  property: JsonSchema,
  scope: SheetColumnScope,
  required: boolean,
): SheetColumn {
  const kind: SheetColumnKind = property.enum
    ? 'select'
    : property.type === 'boolean'
      ? 'boolean'
      : property.type === 'integer' || property.type === 'number'
        ? 'number'
        : 'text'
  return {
    key: `${scope === 'device' ? '' : `${scope}.`}${key}`,
    field: key,
    scope,
    label: (property.title as string | undefined) ?? key,
    kind,
    description: property.description as string | undefined,
    required,
    min: property.minimum,
    max: property.maximum,
    options: property.enum?.map((value) => ({ value: String(value), label: String(value) })),
    fallback: (property.default as SheetValue | undefined) ?? null,
    // A field the manifest gives a default to is one nobody needs to see to
    // add a device — keep it available but out of the way.
    advanced: scope === 'connection' && !required && property.default !== undefined,
  }
}

/**
 * Build the grid's columns for a driver + endpoint type.
 *
 * Order is the order an operator fills them in: what the device is called,
 * where it lives on the network, how it's addressed, then the bookkeeping
 * (type, room, enabled).
 */
export function buildColumns(
  manifest: DriverManifest | undefined,
  endpointType: EndpointTypeDefinition | undefined,
  rooms: RoomDTO[],
  mode: SheetMode,
): SheetColumn[] {
  if (!manifest) return []
  const unit = mode === 'unit'
  const columns: SheetColumn[] = [
    {
      key: 'name',
      field: 'name',
      scope: 'device',
      label: 'Name',
      kind: 'text',
      description:
        'The friendly name, shown to everyone using the panels — say “Panel lighting”, not the ' +
        'hardware it happens to run on.',
      required: true,
      // In a 1:1 sheet either name will do (see `connection.name` below).
      requiredUnless: unit ? 'connection.name' : undefined,
      fallback: '',
    },
  ]

  if (unit) {
    // The connection's own name — a *different* name on purpose, and the
    // reason it's a column and not something derived. The connection is what
    // an integrator sees in Connections and reasons about while wiring ("Hall
    // 1 — Netio 2"); the device name above is what a custodian who has never
    // heard of a Netio reads on the panel ("Panel lighting"). Either one may
    // be left blank and takes the other's value on save, so a rack of
    // identical hardware still only needs one column filled in.
    columns.push({
      key: 'connection.name',
      field: 'name',
      scope: 'connection',
      label: 'Connection name',
      kind: 'text',
      description:
        'The technical name, listed under Connections — e.g. “Hall 1 — Iiyama 3”. Left blank it ' +
        'takes the device name.',
      required: true,
      requiredUnless: 'name',
      fallback: '',
    })

    const required = new Set(manifest.connectionSchema.required ?? [])
    for (const [key, property] of scalarProperties(manifest.connectionSchema)) {
      columns.push(columnFromSchema(key, property, 'connection', required.has(key)))
    }
  }

  const addressRequired = new Set(endpointType?.addressSchema.required ?? [])
  for (const [key, property] of scalarProperties(endpointType?.addressSchema)) {
    columns.push(columnFromSchema(key, property, 'address', addressRequired.has(key)))
  }

  columns.push(
    {
      key: 'type',
      field: 'type',
      scope: 'device',
      label: 'Type',
      kind: 'select',
      required: true,
      options: DEVICE_TYPES.map((type) => ({ value: type, label: type })),
      fallback: 'custom',
    },
    {
      key: 'roomId',
      field: 'roomId',
      scope: 'device',
      label: 'Room',
      kind: 'select',
      options: rooms.map((room) => ({ value: room.id, label: room.name })),
      fallback: null,
    },
    {
      key: 'enabled',
      field: 'enabled',
      scope: 'device',
      label: 'Enabled',
      kind: 'boolean',
      fallback: true,
    },
  )

  return columns
}

// ── cell values ─────────────────────────────────────────────────────────────

/** Render a value as the text shown in a cell (and copied to the clipboard). */
export function formatCell(column: SheetColumn, value: SheetValue): string {
  if (value === null || value === undefined) return ''
  if (column.kind === 'boolean') return value ? 'yes' : 'no'
  if (column.kind === 'select') {
    const option = column.options?.find((o) => o.value === String(value))
    return option?.label ?? String(value)
  }
  return String(value)
}

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'on', 'ano', 'zap'])
const FALSY = new Set(['false', 'no', 'n', '0', 'off', 'ne', 'vyp'])

/**
 * Turn typed or pasted text into the column's value type.
 *
 * Select columns match on the *label* first, so a Google Sheets column of room
 * names ("Hall A") pastes straight in and resolves to room ids — the operator
 * never sees a UUID.
 */
export function parseCell(column: SheetColumn, raw: string): SheetValue {
  const text = raw.trim()
  if (!text) return column.kind === 'boolean' ? false : null
  if (column.kind === 'boolean') {
    if (TRUTHY.has(text.toLowerCase())) return true
    if (FALSY.has(text.toLowerCase())) return false
    return null
  }
  if (column.kind === 'number') {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : text
  }
  if (column.kind === 'select') {
    const lowered = text.toLowerCase()
    const match =
      column.options?.find((o) => o.label.toLowerCase() === lowered) ??
      column.options?.find((o) => o.value.toLowerCase() === lowered)
    return match ? match.value : text
  }
  return text
}

/**
 * Client-side check for one cell — instant feedback while typing. The server
 * re-validates everything against the driver manifest on save; this only
 * catches what can be known without it.
 *
 * `row` is only consulted for `requiredUnless` columns (the two names), where
 * whether a blank cell is a problem depends on its counterpart.
 */
export function validateCell(
  column: SheetColumn,
  value: SheetValue,
  row?: Record<string, SheetValue>,
): string | null {
  const empty = value === null || value === ''
  if (column.required && empty) {
    const standIn = column.requiredUnless ? row?.[column.requiredUnless] : undefined
    if (standIn === undefined || standIn === null || standIn === '') return 'Required'
  }
  if (empty) return null
  if (column.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Must be a number'
    if (column.min !== undefined && value < column.min) return `Must be ≥ ${column.min}`
    if (column.max !== undefined && value > column.max) return `Must be ≤ ${column.max}`
  }
  if (column.kind === 'select' && column.options?.length) {
    if (!column.options.some((o) => o.value === String(value))) return 'Not a valid option'
  }
  return null
}

// ── clipboard (Google Sheets / Excel interop) ───────────────────────────────

/**
 * Parse a clipboard payload into a grid of cell texts.
 *
 * Sheets and Excel both put TSV on the clipboard, quoting any cell that itself
 * contains a tab, newline or quote (`""` escapes a quote inside a quoted cell) —
 * so a naive `split('\t')` mangles exactly the cells a careful operator worried
 * about. This walks the text instead.
 */
export function parseClipboardGrid(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"' && cell === '') {
      quoted = true
    } else if (char === '\t') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      // Swallow the \n of a \r\n pair.
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  // A trailing newline yields one empty row; drop it.
  return rows.filter((r) => r.length > 1 || r[0] !== '')
}

/** Serialise a block of cells as TSV, quoting the ones that need it. */
export function toClipboardGrid(grid: string[][]): string {
  return grid
    .map((row) =>
      row
        .map((cell) => (/[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join('\t'),
    )
    .join('\n')
}

// ── series continuation (the reason 64 rows take one minute) ────────────────

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
/** Trailing integer with whatever surrounds it: "Displej 07" → ["Displej ", "07", ""]. */
const TRAILING_NUMBER = /^(.*?)(\d+)(\D*)$/

const toIpv4 = (text: string): number | null => {
  const match = IPV4.exec(text)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return null
  return ((octets[0]! << 24) >>> 0) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!
}

const fromIpv4 = (value: number): string =>
  [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')

/**
 * Continue a series from one or more seed values.
 *
 * Handles the two patterns a rack of identical hardware is named and addressed
 * by: a trailing counter ("Displej 01" → "Displej 02", zero-padding preserved)
 * and an IPv4 address, incremented as a 32-bit number so `10.0.1.255` is
 * followed by `10.0.2.0` rather than something invalid. Two or more seeds set
 * the step (`10, 20` → `30`); anything the rules don't recognise repeats the
 * last seed, which is the right answer for a column of identical values.
 *
 * One deliberate exception: a seed that is *only* a number ("1515", "1") is
 * held constant unless a second seed proves a series was meant. A bare number
 * in this grid is a setting — a port, a timeout, the display ID every set on
 * its own IP shares — and marching it down 64 rows would be wrong every time;
 * a name or an address, which carry text or dots around the digits, is the
 * opposite. Type two rows to opt a numeric column into counting.
 */
export function extendSeries(seeds: string[], count: number): string[] {
  const filled = seeds.filter((seed) => seed !== '')
  const last = filled[filled.length - 1] ?? ''
  if (count <= 0) return []
  if (!filled.length) return Array.from({ length: count }, () => '')

  const addresses = filled.map(toIpv4)
  if (addresses.every((address) => address !== null)) {
    const numbers = addresses as number[]
    const step =
      numbers.length > 1 ? (numbers[numbers.length - 1]! - numbers[0]!) / (numbers.length - 1) : 1
    return Array.from({ length: count }, (_, index) =>
      fromIpv4((numbers[numbers.length - 1]! + Math.round(step) * (index + 1)) >>> 0),
    )
  }

  const parts = filled.map((seed) => TRAILING_NUMBER.exec(seed))
  const lastPart = parts[parts.length - 1]
  const samePattern =
    lastPart && parts.every((part) => part && part[1] === lastPart[1] && part[3] === lastPart[3])
  if (samePattern) {
    const numbers = parts.map((part) => Number(part![2]))
    // A lone bare number is a setting, not a counter — hold it (see above).
    const soloStep = lastPart[1] === '' && lastPart[3] === '' ? 0 : 1
    const step =
      numbers.length > 1
        ? (numbers[numbers.length - 1]! - numbers[0]!) / (numbers.length - 1)
        : soloStep
    const width = lastPart[2]!.length
    return Array.from({ length: count }, (_, index) => {
      const next = numbers[numbers.length - 1]! + Math.round(step) * (index + 1)
      const digits = String(Math.max(next, 0))
      return `${lastPart[1]}${digits.padStart(width, '0')}${lastPart[3]}`
    })
  }

  return Array.from({ length: count }, () => last)
}

// ── rows ────────────────────────────────────────────────────────────────────

/** Read a column's current value off a saved device (+ its connection). */
function valueFromRecords(
  column: SheetColumn,
  device: DeviceDTO,
  connection: ConnectionDTO | undefined,
): SheetValue {
  if (column.scope === 'address') {
    return ((device.address as Record<string, SheetValue> | null)?.[column.field] ??
      null) as SheetValue
  }
  if (column.scope === 'connection') {
    if (!connection) return null
    if (column.field === 'host') return connection.host
    if (column.field === 'port') return connection.port
    if (column.field === 'name') return connection.name
    if (column.field === 'enabled') return connection.enabled
    return ((connection.config as Record<string, SheetValue> | null)?.[column.field] ??
      null) as SheetValue
  }
  return (device as unknown as Record<string, SheetValue>)[column.field] ?? null
}

/** Turn a saved device into a grid row. */
export function rowFromDevice(
  device: DeviceDTO,
  connection: ConnectionDTO | undefined,
  columns: SheetColumn[],
): SheetRow {
  const values: Record<string, SheetValue> = {}
  for (const column of columns) values[column.key] = valueFromRecords(column, device, connection)
  return { key: device.id, deviceId: device.id, connectionId: device.connectionId, values }
}

/**
 * Build `count` new rows, continuing each column's series from the rows already
 * in the sheet.
 *
 * This is the bulk-create workflow in one function: fill in the first row
 * ("Displej 01", 10.0.1.1, Hall, display), ask for 63 more, and the counter and
 * the IP walk forward while the settled columns (type, room, port) carry down.
 */
export function appendRows(
  rows: SheetRow[],
  columns: SheetColumn[],
  count: number,
  startKey: number,
): SheetRow[] {
  const created: SheetRow[] = Array.from({ length: count }, (_, index) => ({
    key: `new:${startKey + index}`,
    values: {},
  }))

  // Seed from the last few rows so a two-row step ("10, 20") is picked up.
  const seedRows = rows.slice(-3)
  for (const column of columns) {
    if (column.kind === 'text' || column.kind === 'number') {
      const seeds = seedRows.map((row) => formatCell(column, row.values[column.key] ?? null))
      const next = extendSeries(seeds, count)
      created.forEach((row, index) => {
        row.values[column.key] = seeds.some((seed) => seed !== '')
          ? parseCell(column, next[index] ?? '')
          : column.fallback
      })
    } else {
      // Settled choices (type, room, enabled) carry down unchanged.
      const carried = seedRows.length
        ? seedRows[seedRows.length - 1]!.values[column.key]
        : undefined
      created.forEach((row) => {
        row.values[column.key] = carried ?? column.fallback
      })
    }
  }
  return created
}

/** Rows whose values differ from the saved snapshot (plus every unsaved row). */
export function dirtyRows(rows: SheetRow[], originals: Map<string, SheetRow>): SheetRow[] {
  return rows.filter((row) => {
    if (!row.deviceId) return true
    const original = originals.get(row.key)
    if (!original) return true
    return Object.keys(row.values).some((key) => row.values[key] !== original.values[key])
  })
}

/** Group a row's values by scope, dropping the ones left empty. */
function scopedValues(
  row: SheetRow,
  columns: SheetColumn[],
  scope: SheetColumnScope,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const column of columns) {
    if (column.scope !== scope) continue
    const value = row.values[column.key]
    if (value === null || value === '') continue
    result[column.field] = value
  }
  return result
}

/** Connection columns that are dedicated table columns rather than `config` keys. */
const CONNECTION_COLUMNS = new Set(['host', 'port', 'name', 'enabled'])

export interface BuildPayloadOptions {
  mode: SheetMode
  driverId: string
  endpointType: string | undefined
  /** The gateway every row hangs off, in `endpoint` mode. */
  connectionId?: string
}

/**
 * Turn edited rows into a `POST /bulk/devices` body.
 *
 * Patch semantics throughout: a row only sends the fields its columns actually
 * carry, so a sheet that only shows Name and Room can't silently blank a
 * description set elsewhere. In `unit` mode the connection travels nested
 * inside its row — one physical box, one row, both records.
 */
export function buildBulkPayload(
  rows: SheetRow[],
  columns: SheetColumn[],
  options: BuildPayloadOptions,
): BulkDeviceRowInput[] {
  return rows.map((row) => {
    const device = scopedValues(row, columns, 'device')
    const address = scopedValues(row, columns, 'address')
    const connectionValues = scopedValues(row, columns, 'connection')
    // The two names stand in for each other: fill either column and the row is
    // complete. Only in `unit` mode is there a connection name to borrow.
    const deviceName =
      (device.name as string | undefined) ??
      (options.mode === 'unit' ? (connectionValues.name as string | undefined) : undefined)
    const input: BulkDeviceRowInput = {
      deviceId: row.deviceId,
      name: deviceName,
      type: device.type as string | undefined,
      subtype: options.endpointType,
      // An unset room is a real value (clear it), unlike an omitted column.
      roomId: columns.some((c) => c.key === 'roomId')
        ? ((row.values.roomId as string | null) ?? null)
        : undefined,
      enabled: columns.some((c) => c.key === 'enabled') ? row.values.enabled !== false : undefined,
    }
    if (Object.keys(address).length) input.address = address

    if (options.mode === 'unit') {
      const config: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(connectionValues)) {
        if (!CONNECTION_COLUMNS.has(key)) config[key] = value
      }
      input.connection = {
        id: row.connectionId,
        // Its own name when the operator gave it one — the technical name and
        // the friendly one are different things and both are worth keeping —
        // and the device's name when they didn't, so a rack of identical
        // hardware still needs only one name column filled in.
        name: (connectionValues.name as string | undefined) ?? deviceName,
        driverId: row.connectionId ? undefined : options.driverId,
        host: (connectionValues.host as string | undefined) ?? null,
        port: (connectionValues.port as number | undefined) ?? null,
        config,
        enabled: input.enabled,
      }
    } else if (!row.deviceId) {
      input.connectionId = options.connectionId
    }
    return input
  })
}

// ── selection geometry ──────────────────────────────────────────────────────

/** The rectangle spanned by two cells, in either drag direction. */
export function rangeBetween(anchor: CellRef, focus: CellRef): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  }
}

export function isInRange(range: CellRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right
}
