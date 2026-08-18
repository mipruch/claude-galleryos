/**
 * Device-provisioning tests — the decisions the bulk "create devices from
 * connections" flow makes before anything reaches the server: which
 * connections qualify, what a device would be called and categorised as, which
 * room is guessed out of a name, and the batch that finally posts.
 */
import { describe, expect, it } from 'vitest'
import type { DriverManifest } from '@gallery/driver-core'
import type { ConnectionWithRuntime } from '@gallery/types'
import {
  blockReasonOf,
  buildCandidates,
  buildProvisionPayload,
  connectionsWithoutDevices,
  deviceTypeOf,
  endpointLabel,
  groupCandidates,
  guessRoomId,
  initialRows,
  summarizeCandidates,
} from '@/lib/deviceProvisioning'
import { makeDevice, makeRoom } from './fixtures'

/** A 1:1 display driver — one connection, one endpoint, address fully defaulted. */
const iiyama: DriverManifest = {
  id: 'iiyama-prolite',
  name: 'Iiyama Prolite Display',
  version: '0.1.0',
  vendor: 'Iiyama',
  connectionSchema: { type: 'object', properties: {} },
  capabilities: { discovery: false, subscriptions: false, bidirectional: true },
  soloEndpointType: 'iiyama-prolite.display',
  endpointTypes: [
    {
      type: 'iiyama-prolite.display',
      name: 'Display',
      addressSchema: { type: 'object', properties: {} },
      stateSchema: { type: 'object', properties: {} },
      commands: [
        { command: 'on', description: 'on', paramsSchema: { type: 'object', properties: {} } },
        { command: 'off', description: 'off', paramsSchema: { type: 'object', properties: {} } },
      ],
    },
  ],
}

/** A 1:1 driver whose one required address property has a default (Samsung's displayId). */
const samsung: DriverManifest = {
  ...iiyama,
  id: 'samsung-mdc',
  name: 'Samsung MDC Display',
  vendor: 'Samsung',
  soloEndpointType: 'samsung-mdc.display',
  endpointTypes: [
    {
      type: 'samsung-mdc.display',
      name: 'Display',
      addressSchema: {
        type: 'object',
        required: ['displayId'],
        properties: { displayId: { type: 'integer', default: 1 } },
      },
      stateSchema: { type: 'object', properties: {} },
      commands: [
        { command: 'on', description: 'on', paramsSchema: { type: 'object', properties: {} } },
      ],
    },
  ],
}

/** A gateway: one connection fans out to many fixtures, so nothing can be guessed. */
const foxtron: DriverManifest = {
  id: 'dali-foxtron',
  name: 'Foxtron Gateway',
  version: '0.1.0',
  vendor: 'Foxtron',
  connectionSchema: { type: 'object', properties: {} },
  capabilities: { discovery: false, subscriptions: false, bidirectional: true },
  endpointTypes: [
    {
      type: 'dali-foxtron.fixture',
      name: 'DALI Fixture',
      addressSchema: { type: 'object', properties: { daliAddress: { type: 'integer' } } },
      stateSchema: { type: 'object', properties: {} },
      commands: [
        { command: 'on', description: 'on', paramsSchema: { type: 'object', properties: {} } },
      ],
    },
  ],
}

/** A 1:1 driver whose required address value has no default — only the installer knows it. */
const unguessable: DriverManifest = {
  ...samsung,
  id: 'mystery',
  name: 'Mystery Display',
  soloEndpointType: 'mystery.display',
  endpointTypes: [
    {
      type: 'mystery.display',
      name: 'Display',
      addressSchema: {
        type: 'object',
        required: ['nodeId'],
        properties: { nodeId: { type: 'integer' } },
      },
      stateSchema: { type: 'object', properties: {} },
      commands: [],
    },
  ],
}

const MANIFESTS: Record<string, DriverManifest> = {
  'iiyama-prolite': iiyama,
  'samsung-mdc': samsung,
  'dali-foxtron': foxtron,
  mystery: unguessable,
}
const manifestOf = (driverId: string): DriverManifest | undefined => MANIFESTS[driverId]

function makeConnection(over: Partial<ConnectionWithRuntime> = {}): ConnectionWithRuntime {
  return {
    id: 'c1',
    name: 'Connection',
    driverId: 'iiyama-prolite',
    host: '192.168.0.20',
    port: 5000,
    protocol: 'tcp',
    config: {},
    enabled: true,
    running: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin',
    ...over,
  }
}

const ROOMS = [makeRoom({ id: 'r1', name: 'Hall 1' }), makeRoom({ id: 'r2', name: 'Hall' })]

describe('connectionsWithoutDevices', () => {
  it('keeps only the connections nothing hangs off', () => {
    const bare = connectionsWithoutDevices(
      [makeConnection({ id: 'c1' }), makeConnection({ id: 'c2' })],
      [makeDevice({ id: 'd1', connectionId: 'c2' })],
    )
    expect(bare.map((c) => c.id)).toEqual(['c1'])
  })
})

describe('blockReasonOf', () => {
  it('lets a 1:1 driver through when its address is fully defaulted', () => {
    expect(blockReasonOf(iiyama)).toBeUndefined()
    expect(blockReasonOf(samsung)).toBeUndefined()
  })

  it('blocks a gateway — how many endpoints it has is a question about the bus', () => {
    expect(blockReasonOf(foxtron)).toBe('gateway')
  })

  it('blocks a required address value that has no default', () => {
    expect(blockReasonOf(unguessable)).toBe('addressing')
  })

  it('blocks a driver that is not installed', () => {
    expect(blockReasonOf(undefined)).toBe('no-driver')
  })
})

describe('deviceTypeOf', () => {
  it('categorises from the driver and endpoint names', () => {
    expect(deviceTypeOf(iiyama, iiyama.endpointTypes[0])).toBe('display')
    expect(deviceTypeOf(samsung, samsung.endpointTypes[0])).toBe('display')
    expect(deviceTypeOf(foxtron, undefined)).toBe('lighting')
  })

  it('falls back to custom rather than guessing', () => {
    expect(deviceTypeOf({ ...iiyama, id: 'zzz', name: 'Zzz', vendor: 'Zzz' }, undefined)).toBe(
      'custom',
    )
  })
})

describe('guessRoomId', () => {
  it('matches the longest room name inside a connection name', () => {
    expect(guessRoomId('Iiyama Display Hall 1 Left', ROOMS)).toBe('r1')
  })

  it('ignores diacritics on both sides', () => {
    expect(guessRoomId('Displej Sál 2', [makeRoom({ id: 'r3', name: 'Sal 2' })])).toBe('r3')
  })

  it('returns null when no room is named', () => {
    expect(guessRoomId('Samsung TV Foyer', ROOMS)).toBeNull()
  })
})

describe('endpointLabel', () => {
  it('is host:port, degrading to the host and then the name', () => {
    expect(endpointLabel(makeConnection())).toBe('192.168.0.20:5000')
    expect(endpointLabel(makeConnection({ port: null }))).toBe('192.168.0.20')
    expect(endpointLabel(makeConnection({ host: null, name: 'Serial bus' }))).toBe('Serial bus')
  })
})

describe('buildCandidates', () => {
  const connections = [
    makeConnection({ id: 'c10', name: 'Iiyama Display Hall 1 Left', host: '192.168.0.20' }),
    makeConnection({ id: 'c2', name: 'Iiyama Display Hall 1 Right', host: '192.168.0.21' }),
    makeConnection({
      id: 'c3',
      name: 'Foxtron Gateway 2',
      driverId: 'dali-foxtron',
      host: '192.168.0.60',
      port: 502,
    }),
    makeConnection({
      id: 'c4',
      name: 'Samsung TV Foyer',
      driverId: 'samsung-mdc',
      host: '192.168.0.41',
      port: 1515,
    }),
  ]

  const candidates = buildCandidates(connections, [], manifestOf, ROOMS, (id) =>
    id === 'c2' ? { online: false, lastSeen: '2026-08-12T09:00:00.000Z' } : { online: true },
  )

  it('pre-fills the name from the connection and guesses the room', () => {
    const first = candidates.find((c) => c.connectionId === 'c10')
    expect(first?.suggestedName).toBe('Iiyama Display Hall 1 Left')
    expect(first?.guessedRoomId).toBe('r1')
    expect(first?.deviceType).toBe('display')
    expect(first?.subtype).toBe('iiyama-prolite.display')
    expect(first?.endpoint).toBe('192.168.0.20:5000')
  })

  it('marks the gateway blocked and gives it no endpoint type', () => {
    const gateway = candidates.find((c) => c.connectionId === 'c3')
    expect(gateway?.blocked).toBe('gateway')
    expect(gateway?.subtype).toBeUndefined()
  })

  it('carries the live socket state through', () => {
    expect(candidates.find((c) => c.connectionId === 'c2')?.online).toBe(false)
    expect(candidates.find((c) => c.connectionId === 'c2')?.lastSeen).toBe(
      '2026-08-12T09:00:00.000Z',
    )
  })

  it('sorts by name, numerically', () => {
    const names = buildCandidates(
      [
        makeConnection({ id: 'a', name: 'Display 10' }),
        makeConnection({ id: 'b', name: 'Display 2' }),
      ],
      [],
      manifestOf,
      [],
    ).map((c) => c.connectionName)
    expect(names).toEqual(['Display 2', 'Display 10'])
  })

  it('skips connections that already carry a device', () => {
    const withDevice = buildCandidates(
      connections,
      [makeDevice({ connectionId: 'c4' })],
      manifestOf,
      ROOMS,
    )
    expect(withDevice.map((c) => c.connectionId)).not.toContain('c4')
  })

  describe('grouping', () => {
    const groups = groupCandidates(candidates)

    it('groups by driver and pushes the blocked driver last', () => {
      expect(groups.map((g) => g.driverId)).toEqual([
        'iiyama-prolite',
        'samsung-mdc',
        'dali-foxtron',
      ])
    })

    it('labels how each group is wired', () => {
      expect(groups[0]?.kindLabel).toBe('display driver')
      expect(groups[2]?.kindLabel).toBe('lighting bus')
    })

    it('summarises the whole batch for the nudge, pluralising the driver names', () => {
      expect(summarizeCandidates(candidates)).toBe(
        '2 Iiyama Prolite Displays, 1 Samsung MDC Display, 1 Foxtron Gateway',
      )
    })
  })

  describe('initialRows', () => {
    const rows = initialRows(candidates)

    it('pre-selects the connections that are both provisionable and answering', () => {
      expect(rows.find((r) => r.connectionId === 'c10')?.selected).toBe(true)
    })

    it('leaves an offline connection unselected rather than adding a dead tile', () => {
      expect(rows.find((r) => r.connectionId === 'c2')?.selected).toBe(false)
    })

    it('never selects a blocked connection', () => {
      expect(rows.find((r) => r.connectionId === 'c3')?.selected).toBe(false)
    })

    it('selects everything provisionable when nothing is answering at all', () => {
      // A system configured before the hardware is on the network: "offline"
      // then says nothing about any one connection, so it can't disqualify them.
      const allOffline = buildCandidates(connections, [], manifestOf, ROOMS, () => ({
        online: false,
      }))
      const offlineRows = initialRows(allOffline)
      expect(offlineRows.filter((r) => r.selected)).toHaveLength(3)
      expect(offlineRows.find((r) => r.connectionId === 'c3')?.selected).toBe(false)
    })
  })

  describe('buildProvisionPayload', () => {
    it('posts only selected, valid rows, with the operator edits applied', () => {
      const rows = initialRows(candidates)
      const target = rows.find((r) => r.connectionId === 'c4')!
      target.selected = true
      target.name = '  Foyer TV  '
      target.roomId = 'r1'
      expect(buildProvisionPayload(rows, candidates)).toContainEqual({
        connectionId: 'c4',
        name: 'Foyer TV',
        type: 'display',
        roomId: 'r1',
      })
    })

    it('drops a selected row whose name was cleared', () => {
      const rows = initialRows(candidates)
      const target = rows.find((r) => r.connectionId === 'c10')!
      target.name = '   '
      expect(buildProvisionPayload(rows, candidates).map((r) => r.connectionId)).not.toContain(
        'c10',
      )
    })

    it('never posts a blocked row, even if something selected it', () => {
      const rows = initialRows(candidates)
      rows.find((r) => r.connectionId === 'c3')!.selected = true
      expect(buildProvisionPayload(rows, candidates).map((r) => r.connectionId)).not.toContain('c3')
    })

    it('leaves the endpoint type and address to the server', () => {
      const rows = initialRows(candidates)
      for (const row of buildProvisionPayload(rows, candidates)) {
        expect(row).not.toHaveProperty('subtype')
        expect(row).not.toHaveProperty('address')
      }
    })
  })
})
