/**
 * Connection-sheet mapping — columns, row hydration and the payload for
 * `POST /api/v1/bulk/connections`.
 *
 * This is the sheet that carries the job the whole bulk editor exists for:
 * standing up a site is mostly *connections* — twenty NETIOs, sixty displays —
 * and each is little more than a name and an address. It deliberately shows
 * nothing else:
 *
 *  - **No filtering to get started.** Every connection is in one table
 *    regardless of driver, because the driver is a column, not a prerequisite.
 *  - **No endpoint decisions.** A connection exists on its own; what hangs off
 *    it is the device sheet's business.
 *  - **Only the config a driver truly demands.** Everything the manifest gives
 *    a default gets filled in server-side, so the sheet stays as narrow as the
 *    customer's own spreadsheet. What a driver *requires* (a MAC address for
 *    Wake-on-LAN) does get a column — otherwise those rows could never be
 *    saved from here at all.
 */

import type { DriverManifest, JsonSchema } from '@gallery/driver-core'
import type { BulkConnectionRowInput, ConnectionDTO } from '@gallery/types'
import type { SheetColumn, SheetRow, SheetValue } from './bulkSheet'

/** Columns that are real `connections` table columns rather than config keys. */
const TABLE_COLUMNS = new Set(['host', 'port', 'name', 'enabled', 'protocol'])

function kindOf(property: JsonSchema): SheetColumn['kind'] {
  if (property.enum) return 'select'
  if (property.type === 'boolean') return 'boolean'
  if (property.type === 'integer' || property.type === 'number') return 'number'
  return 'text'
}

/**
 * Build the connection sheet's columns from every installed driver at once.
 *
 * `host` and `port` are shown for all rows because effectively every driver has
 * them. Beyond that, only *required* config properties earn a column, unioned
 * across drivers and labelled with the driver that needs them — a cell that
 * doesn't apply to a row's driver simply stays empty and is ignored on save.
 */
export function buildConnectionColumns(manifests: DriverManifest[]): SheetColumn[] {
  const columns: SheetColumn[] = [
    {
      key: 'name',
      field: 'name',
      scope: 'connection',
      label: 'Name',
      kind: 'text',
      description: 'What this socket is called in Connections — e.g. “Hall 1 — Netio 2”.',
      required: true,
      fallback: '',
      width: '18rem',
    },
    {
      key: 'driverId',
      field: 'driverId',
      scope: 'connection',
      label: 'Driver',
      kind: 'select',
      required: true,
      options: manifests.map((manifest) => ({ value: manifest.id, label: manifest.name })),
      fallback: null,
      width: '13rem',
    },
    {
      key: 'host',
      field: 'host',
      scope: 'connection',
      label: 'Host / IP',
      kind: 'text',
      required: true,
      fallback: '',
      width: '11rem',
    },
    {
      key: 'port',
      field: 'port',
      scope: 'connection',
      label: 'Port',
      kind: 'number',
      description: 'Left blank, the driver’s own default applies.',
      fallback: null,
      width: '7rem',
    },
  ]

  // Required config, unioned across drivers. Two drivers naming the same
  // property share one column; the label says who needs it.
  const seen = new Map<string, string[]>()
  for (const manifest of manifests) {
    for (const key of manifest.connectionSchema.required ?? []) {
      if (TABLE_COLUMNS.has(key)) continue
      const property = (manifest.connectionSchema.properties ?? {})[key] as JsonSchema | undefined
      if (!property || property.type === 'array' || property.type === 'object') continue
      const owners = seen.get(key)
      if (owners) {
        owners.push(manifest.name)
        continue
      }
      seen.set(key, [manifest.name])
      columns.push({
        key: `config.${key}`,
        field: key,
        scope: 'connection',
        label: (property.title as string | undefined) ?? key,
        kind: kindOf(property),
        description: property.description as string | undefined,
        options: property.enum?.map((value) => ({ value: String(value), label: String(value) })),
        fallback: (property.default as SheetValue | undefined) ?? null,
        width: '13rem',
      })
    }
  }
  for (const column of columns) {
    const owners = seen.get(column.field)
    if (owners)
      column.description = `Required by ${owners.join(', ')}. ${column.description ?? ''}`.trim()
  }

  columns.push({
    key: 'enabled',
    field: 'enabled',
    scope: 'connection',
    label: 'Enabled',
    kind: 'boolean',
    description: 'Start the driver and connect on save.',
    fallback: true,
    width: '6rem',
  })
  return columns
}

/** Turn a saved connection into a grid row. */
export function rowFromConnection(connection: ConnectionDTO, columns: SheetColumn[]): SheetRow {
  const config = (connection.config as Record<string, SheetValue> | null) ?? {}
  const values: Record<string, SheetValue> = {}
  for (const column of columns) {
    values[column.key] = column.key.startsWith('config.')
      ? (config[column.field] ?? null)
      : ((connection as unknown as Record<string, SheetValue>)[column.field] ?? null)
  }
  return { key: connection.id, connectionId: connection.id, values }
}

/**
 * Turn edited rows into a `POST /bulk/connections` body.
 *
 * Config travels as a partial: only the keys this sheet actually shows are
 * sent, and the server merges them over the stored config and the manifest
 * defaults. So a sheet that never mentions a poll interval can't blank one.
 */
export function buildConnectionPayload(
  rows: SheetRow[],
  columns: SheetColumn[],
): BulkConnectionRowInput[] {
  return rows.map((row) => {
    const config: Record<string, unknown> = {}
    for (const column of columns) {
      if (!column.key.startsWith('config.')) continue
      const value = row.values[column.key]
      if (value !== null && value !== '') config[column.field] = value
    }
    const port = row.values.port
    return {
      connectionId: row.connectionId,
      name: (row.values.name as string | undefined) || undefined,
      driverId: row.connectionId
        ? undefined
        : ((row.values.driverId as string | null) ?? undefined),
      host: (row.values.host as string | null) || null,
      port: typeof port === 'number' ? port : null,
      config,
      enabled: row.values.enabled !== false,
    }
  })
}
