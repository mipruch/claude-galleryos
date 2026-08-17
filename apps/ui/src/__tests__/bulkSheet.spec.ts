/**
 * Bulk-sheet logic tests — the parts of the spreadsheet editor worth testing
 * without a DOM: the column model derived from a driver manifest, clipboard
 * interop with Google Sheets, series continuation (what turns one filled row
 * into 64), and the payload the grid finally posts.
 */
import { describe, expect, it } from 'vitest'
import type { DriverManifest } from '@gallery/driver-core'
import type { ConnectionDTO, DeviceDTO, RoomDTO } from '@gallery/types'
import {
  appendRows,
  buildBulkPayload,
  buildColumns,
  dirtyRows,
  extendSeries,
  formatCell,
  parseCell,
  parseClipboardGrid,
  rangeBetween,
  resolveEndpointType,
  rowFromDevice,
  sheetModeOf,
  toClipboardGrid,
  validateCell,
  type SheetColumn,
  type SheetRow,
} from '@/lib/bulkSheet'

/** A 1:1 driver, shaped like the real Samsung MDC manifest. */
const soloManifest: DriverManifest = {
  id: 'samsung-mdc',
  name: 'Samsung MDC Display',
  version: '0.1.0',
  vendor: 'Samsung',
  connectionSchema: {
    type: 'object',
    required: ['host'],
    properties: {
      host: { type: 'string', title: 'Host / IP', format: 'host' },
      port: { type: 'integer', title: 'Port', default: 1515 },
      responseTimeoutMs: { type: 'integer', title: 'Response timeout (ms)', default: 2000 },
    },
  },
  capabilities: { discovery: false, subscriptions: false, bidirectional: true },
  soloEndpointType: 'samsung-mdc.display',
  endpointTypes: [
    {
      type: 'samsung-mdc.display',
      name: 'Display',
      addressSchema: {
        type: 'object',
        required: ['displayId'],
        properties: {
          displayId: { type: 'integer', title: 'Display ID', default: 1, minimum: 1, maximum: 255 },
        },
      },
      stateSchema: { type: 'object', properties: {} },
      commands: [
        { command: 'on', description: 'on', paramsSchema: { type: 'object', properties: {} } },
        { command: 'off', description: 'off', paramsSchema: { type: 'object', properties: {} } },
      ],
    },
  ],
}

/** A gateway driver: many endpoints share one connection. */
const gatewayManifest: DriverManifest = {
  ...soloManifest,
  id: 'netio',
  name: 'NETIO',
  soloEndpointType: undefined,
  endpointTypes: [
    {
      type: 'netio.socket',
      name: 'Power Socket',
      addressSchema: {
        type: 'object',
        required: ['outputId'],
        properties: { outputId: { type: 'integer', title: 'Output ID', minimum: 1, maximum: 8 } },
      },
      stateSchema: { type: 'object', properties: {} },
      commands: [
        { command: 'on', description: 'on', paramsSchema: { type: 'object', properties: {} } },
      ],
    },
  ],
}

const rooms: RoomDTO[] = [
  { id: 'r1', name: 'Hall A' } as RoomDTO,
  { id: 'r2', name: 'Hall B' } as RoomDTO,
]

const columnsFor = (manifest: DriverManifest): SheetColumn[] =>
  buildColumns(manifest, resolveEndpointType(manifest), rooms, sheetModeOf(manifest))

const column = (columns: SheetColumn[], key: string): SheetColumn =>
  columns.find((c) => c.key === key)!

describe('sheet shape', () => {
  it('gives a 1:1 driver connection columns, so one row is one physical box', () => {
    const columns = columnsFor(soloManifest)

    expect(sheetModeOf(soloManifest)).toBe('unit')
    expect(columns.map((c) => c.key)).toContain('connection.host')
    expect(columns.map((c) => c.key)).toContain('address.displayId')
    // Ordered the way an operator fills a row in.
    expect(columns[0]!.key).toBe('name')
  })

  it('leaves connection columns out for a gateway driver — the connection is picked once', () => {
    const columns = columnsFor(gatewayManifest)

    expect(sheetModeOf(gatewayManifest)).toBe('endpoint')
    expect(columns.some((c) => c.scope === 'connection')).toBe(false)
    expect(columns.map((c) => c.key)).toContain('address.outputId')
  })

  it('hides driver settings that already have a default behind the advanced toggle', () => {
    const columns = columnsFor(soloManifest)

    expect(column(columns, 'connection.host').advanced).toBeFalsy()
    expect(column(columns, 'connection.responseTimeoutMs').advanced).toBe(true)
    expect(column(columns, 'connection.name').advanced).toBe(true)
  })

  it('offers rooms by name, not id', () => {
    expect(column(columnsFor(soloManifest), 'roomId').options).toEqual([
      { value: 'r1', label: 'Hall A' },
      { value: 'r2', label: 'Hall B' },
    ])
  })
})

describe('cell values', () => {
  const columns = columnsFor(soloManifest)

  it('resolves a select column by its label, so pasted room names land as ids', () => {
    expect(parseCell(column(columns, 'roomId'), 'Hall B')).toBe('r2')
    expect(parseCell(column(columns, 'roomId'), 'hall a')).toBe('r1')
    expect(formatCell(column(columns, 'roomId'), 'r1')).toBe('Hall A')
  })

  it('reads the spellings a spreadsheet actually contains for booleans', () => {
    const enabled = column(columns, 'enabled')
    expect(parseCell(enabled, 'yes')).toBe(true)
    expect(parseCell(enabled, 'TRUE')).toBe(true)
    expect(parseCell(enabled, 'ne')).toBe(false)
    expect(parseCell(enabled, '0')).toBe(false)
  })

  it('keeps a non-numeric entry in a number column visible so it can be corrected', () => {
    const displayId = column(columns, 'address.displayId')
    expect(parseCell(displayId, '7')).toBe(7)
    expect(parseCell(displayId, 'seven')).toBe('seven')
    expect(validateCell(displayId, 'seven')).toBe('Must be a number')
  })

  it('validates against the manifest bounds before anything is sent', () => {
    const displayId = column(columns, 'address.displayId')
    expect(validateCell(displayId, 300)).toBe('Must be ≤ 255')
    expect(validateCell(displayId, 1)).toBeNull()
    expect(validateCell(column(columns, 'name'), null)).toBe('Required')
  })
})

describe('clipboard interop', () => {
  it('parses the TSV a spreadsheet puts on the clipboard', () => {
    expect(parseClipboardGrid('Display 01\t10.0.1.1\nDisplay 02\t10.0.1.2')).toEqual([
      ['Display 01', '10.0.1.1'],
      ['Display 02', '10.0.1.2'],
    ])
  })

  it('handles quoted cells containing tabs, newlines and quotes', () => {
    expect(parseClipboardGrid('"a\tb"\tc\r\n"say ""hi"""\td')).toEqual([
      ['a\tb', 'c'],
      ['say "hi"', 'd'],
    ])
    expect(parseClipboardGrid('"line1\nline2"\tx')).toEqual([['line1\nline2', 'x']])
  })

  it('ignores the trailing newline a copied block ends with', () => {
    expect(parseClipboardGrid('a\tb\n')).toEqual([['a', 'b']])
  })

  it('round-trips a block back out, quoting only what needs it', () => {
    const grid = [
      ['a\tb', 'c'],
      ['plain', 'say "hi"'],
    ]
    expect(toClipboardGrid(grid)).toBe('"a\tb"\tc\nplain\t"say ""hi"""')
    expect(parseClipboardGrid(toClipboardGrid(grid))).toEqual(grid)
  })
})

describe('series continuation', () => {
  it('continues a trailing counter and keeps its zero padding', () => {
    expect(extendSeries(['Displej 01'], 3)).toEqual(['Displej 02', 'Displej 03', 'Displej 04'])
    expect(extendSeries(['Screen 9'], 2)).toEqual(['Screen 10', 'Screen 11'])
  })

  it('takes the step from two seeds', () => {
    expect(extendSeries(['Row 10', 'Row 20'], 2)).toEqual(['Row 30', 'Row 40'])
  })

  it('walks IPv4 addresses as numbers, so a /24 boundary is crossed correctly', () => {
    expect(extendSeries(['10.0.1.1'], 2)).toEqual(['10.0.1.2', '10.0.1.3'])
    expect(extendSeries(['10.0.1.254'], 3)).toEqual(['10.0.1.255', '10.0.2.0', '10.0.2.1'])
    expect(extendSeries(['10.0.1.1', '10.0.1.3'], 2)).toEqual(['10.0.1.5', '10.0.1.7'])
  })

  it('repeats a value it can’t read as a series — a column of identical entries', () => {
    expect(extendSeries(['Lobby'], 2)).toEqual(['Lobby', 'Lobby'])
    expect(extendSeries([], 2)).toEqual(['', ''])
  })

  it('holds a lone bare number, which is a setting rather than a counter', () => {
    // A port, a timeout, the display ID of sets that each have their own IP.
    expect(extendSeries(['1515'], 3)).toEqual(['1515', '1515', '1515'])
    expect(extendSeries(['1'], 2)).toEqual(['1', '1'])
    // Two seeds say a series *was* meant, and it counts from there.
    expect(extendSeries(['1', '2'], 3)).toEqual(['3', '4', '5'])
  })
})

describe('adding rows', () => {
  const columns = columnsFor(soloManifest)

  const seeded = (): SheetRow[] => [
    {
      key: 'new:0',
      values: {
        name: 'Displej 01',
        'connection.host': '10.0.1.1',
        'connection.port': 1515,
        'address.displayId': 1,
        type: 'display',
        roomId: 'r1',
        enabled: true,
      },
    },
  ]

  it('continues names and addresses while carrying the settled columns down', () => {
    const added = appendRows(seeded(), columns, 3, 1)

    expect(added.map((row) => row.values.name)).toEqual(['Displej 02', 'Displej 03', 'Displej 04'])
    expect(added.map((row) => row.values['connection.host'])).toEqual([
      '10.0.1.2',
      '10.0.1.3',
      '10.0.1.4',
    ])
    // Choices don't march anywhere — they repeat.
    expect(added.every((row) => row.values.type === 'display' && row.values.roomId === 'r1')).toBe(
      true,
    )
    // A constant number column stays constant.
    expect(added.every((row) => row.values['connection.port'] === 1515)).toBe(true)
  })

  it('falls back to the manifest defaults for the very first row', () => {
    const [first] = appendRows([], columns, 1, 0)

    expect(first!.values.name).toBe('')
    expect(first!.values['connection.port']).toBe(1515)
    expect(first!.values['address.displayId']).toBe(1)
    expect(first!.values.enabled).toBe(true)
  })

  it('hands out unique keys so rows can be tracked across edits', () => {
    expect(appendRows([], columns, 3, 5).map((row) => row.key)).toEqual(['new:5', 'new:6', 'new:7'])
  })
})

describe('payload', () => {
  const columns = columnsFor(soloManifest)

  const newRow: SheetRow = {
    key: 'new:0',
    values: {
      name: 'Displej 07',
      'connection.host': '10.0.1.7',
      'connection.port': 1515,
      'connection.responseTimeoutMs': 3000,
      'address.displayId': 1,
      type: 'display',
      roomId: 'r1',
      enabled: true,
    },
  }

  it('nests the connection inside a 1:1 row and names it after the device', () => {
    const [payload] = buildBulkPayload([newRow], columns, {
      mode: 'unit',
      driverId: 'samsung-mdc',
      endpointType: 'samsung-mdc.display',
    })

    expect(payload).toMatchObject({
      name: 'Displej 07',
      type: 'display',
      subtype: 'samsung-mdc.display',
      roomId: 'r1',
      address: { displayId: 1 },
      connection: { name: 'Displej 07', driverId: 'samsung-mdc', host: '10.0.1.7', port: 1515 },
    })
    // Driver-specific settings travel in `config`, not as columns of their own.
    expect(payload!.connection!.config).toEqual({ responseTimeoutMs: 3000 })
  })

  it('keeps an explicit connection name when the operator opted into the column', () => {
    const named: SheetRow = {
      ...newRow,
      values: { ...newRow.values, 'connection.name': 'Wall link 7' },
    }
    const [payload] = buildBulkPayload([named], columns, {
      mode: 'unit',
      driverId: 'samsung-mdc',
      endpointType: 'samsung-mdc.display',
    })

    expect(payload!.connection!.name).toBe('Wall link 7')
  })

  it('sends an existing row as an update, carrying both ids', () => {
    const saved: SheetRow = { ...newRow, key: 'd1', deviceId: 'd1', connectionId: 'c1' }
    const [payload] = buildBulkPayload([saved], columns, {
      mode: 'unit',
      driverId: 'samsung-mdc',
      endpointType: 'samsung-mdc.display',
    })

    expect(payload!.deviceId).toBe('d1')
    expect(payload!.connection!.id).toBe('c1')
    // The driver is fixed at creation, so an update never restates it.
    expect(payload!.connection!.driverId).toBeUndefined()
  })

  it('clears a room the operator emptied, rather than silently keeping it', () => {
    const cleared: SheetRow = {
      ...newRow,
      key: 'd1',
      deviceId: 'd1',
      values: { ...newRow.values, roomId: null },
    }
    const [payload] = buildBulkPayload([cleared], columns, {
      mode: 'unit',
      driverId: 'samsung-mdc',
      endpointType: 'samsung-mdc.display',
    })

    expect(payload!.roomId).toBeNull()
  })

  it('attaches gateway rows to the chosen connection instead of making one', () => {
    const gatewayColumns = columnsFor(gatewayManifest)
    const row: SheetRow = {
      key: 'new:0',
      values: { name: 'Socket 3', 'address.outputId': 3, type: 'power', enabled: true },
    }
    const [payload] = buildBulkPayload([row], gatewayColumns, {
      mode: 'endpoint',
      driverId: 'netio',
      endpointType: 'netio.socket',
      connectionId: 'c9',
    })

    expect(payload!.connectionId).toBe('c9')
    expect(payload!.connection).toBeUndefined()
    expect(payload!.address).toEqual({ outputId: 3 })
  })
})

describe('dirty tracking', () => {
  const columns = columnsFor(soloManifest)
  const device = {
    id: 'd1',
    connectionId: 'c1',
    name: 'Displej 01',
    type: 'display',
    subtype: 'samsung-mdc.display',
    roomId: 'r1',
    address: { displayId: 1 },
    enabled: true,
  } as unknown as DeviceDTO
  const connection = {
    id: 'c1',
    name: 'Displej 01',
    driverId: 'samsung-mdc',
    host: '10.0.1.1',
    port: 1515,
    config: { responseTimeoutMs: 2000 },
    enabled: true,
  } as unknown as ConnectionDTO

  it('reads a saved device and its connection into one row', () => {
    const row = rowFromDevice(device, connection, columns)

    expect(row.values).toMatchObject({
      name: 'Displej 01',
      'connection.host': '10.0.1.1',
      'connection.responseTimeoutMs': 2000,
      'address.displayId': 1,
      roomId: 'r1',
    })
  })

  it('reports only rows that actually changed, plus every unsaved one', () => {
    const row = rowFromDevice(device, connection, columns)
    const originals = new Map([[row.key, { ...row, values: { ...row.values } }]])
    const untouched = { ...row, values: { ...row.values } }
    const edited = { ...row, key: 'd2', deviceId: 'd2', values: { ...row.values, roomId: 'r2' } }
    const fresh: SheetRow = { key: 'new:0', values: {} }
    originals.set('d2', { ...row, key: 'd2', deviceId: 'd2', values: { ...row.values } })

    expect(dirtyRows([untouched, edited, fresh], originals).map((r) => r.key)).toEqual([
      'd2',
      'new:0',
    ])
  })
})

describe('selection geometry', () => {
  it('normalises a range dragged in any direction', () => {
    expect(rangeBetween({ row: 5, col: 3 }, { row: 1, col: 1 })).toEqual({
      top: 1,
      left: 1,
      bottom: 5,
      right: 3,
    })
  })
})
