import { describe, it, expect } from 'vitest'
import type { RoomDTO } from '@gallery/types'
import {
  applyRevert,
  deviceKind,
  deviceTypesOf,
  filterByRooms,
  filterByTypes,
  groupDevices,
  matrixInputs,
  readInt,
  roomOptionsOf,
  searchDevices,
  snapshotState,
  typeLabel,
  type DeviceRecord,
} from '@/lib/devices'

import { makeDevice, makeRoom } from './fixtures'

/** Minimal device fixture — only the fields the grouping helpers read. */
function dev(id: string, type: string, roomId: string | null = null): DeviceRecord {
  return makeDevice({ id, name: id, type, roomId })
}

function room(id: string, name: string, displayOrder: number): RoomDTO {
  return makeRoom({ id, name, displayOrder })
}

describe('snapshotState / applyRevert (optimistic rollback)', () => {
  it('snapshots only the patched keys, marking absent ones undefined', () => {
    const current = { level: 0.5, muted: false }
    expect(snapshotState(current, { level: 1, on: true })).toEqual({ level: 0.5, on: undefined })
  })

  it('round-trips: applying the snapshot restores the original', () => {
    const current = { level: 0.5, muted: false }
    const patch = { level: 1, on: true }
    const snapshot = snapshotState(current, patch)
    const optimistic = { ...current, ...patch } // { level: 1, muted: false, on: true }
    expect(applyRevert(optimistic, snapshot)).toEqual(current)
  })

  it('deletes keys that did not exist before the patch', () => {
    const reverted = applyRevert({ on: true, power: 'on' }, { on: undefined, power: undefined })
    expect(reverted).toEqual({})
  })

  it('does not mutate the input', () => {
    const optimistic = { level: 1 }
    applyRevert(optimistic, { level: 0.5 })
    expect(optimistic).toEqual({ level: 1 })
  })
})

describe('typeLabel', () => {
  it('maps known types and capitalises unknown ones', () => {
    expect(typeLabel('light')).toBe('Lights')
    expect(typeLabel('audio')).toBe('Audio')
    expect(typeLabel('gadget')).toBe('Gadget')
  })
})

describe('deviceTypesOf', () => {
  it('returns distinct types, sorted', () => {
    expect(deviceTypesOf([dev('a', 'video'), dev('b', 'audio'), dev('c', 'audio')])).toEqual([
      'audio',
      'video',
    ])
  })
})

describe('filterByTypes', () => {
  const list = [dev('a', 'audio'), dev('b', 'video'), dev('c', 'light')]

  it('returns everything when no types are selected', () => {
    expect(filterByTypes(list, [])).toHaveLength(3)
  })

  it('keeps only the selected types', () => {
    expect(filterByTypes(list, ['audio', 'light']).map((d) => d.id)).toEqual(['a', 'c'])
  })
})

describe('filterByRooms', () => {
  const list = [dev('a', 'audio', 'r1'), dev('b', 'video', 'r2'), dev('c', 'light', null)]

  it('returns everything when no rooms are selected', () => {
    expect(filterByRooms(list, [])).toHaveLength(3)
  })

  it('keeps only the selected rooms, with the sentinel matching room-less devices', () => {
    expect(filterByRooms(list, ['r1', '__unassigned__']).map((d) => d.id)).toEqual(['a', 'c'])
  })
})

describe('roomOptionsOf', () => {
  const rooms = [room('r1', 'Hall', 1), room('r2', 'Foyer', 0)]

  it('lists only rooms with devices, ordered by displayOrder (unassigned last) with counts', () => {
    const list = [dev('a', 'audio', 'r1'), dev('b', 'video', 'r2'), dev('c', 'light', 'r2'), dev('d', 'light', null)]
    expect(roomOptionsOf(list, rooms)).toEqual([
      { key: 'r2', name: 'Foyer', count: 2 },
      { key: 'r1', name: 'Hall', count: 1 },
      { key: '__unassigned__', name: 'Unassigned', count: 1 },
    ])
  })
})

describe('searchDevices', () => {
  const rooms = [room('r1', 'Sál A', 0), room('r2', 'Foyer', 1)]
  const list: DeviceRecord[] = [
    makeDevice({ id: 'a', name: 'Projector', description: 'Main hall beamer', type: 'video', roomId: 'r1' }),
    makeDevice({ id: 'b', name: 'Ceiling Light', description: null, type: 'light', roomId: 'r2' }),
    makeDevice({ id: 'c', name: 'Mic 1', description: 'Lectern microphone', type: 'audio', roomId: null }),
  ]

  it('returns everything for a blank query', () => {
    expect(searchDevices(list, '   ', rooms)).toHaveLength(3)
  })

  it('matches on name', () => {
    expect(searchDevices(list, 'project', rooms).map((d) => d.id)).toEqual(['a'])
  })

  it('matches on description and is case-insensitive', () => {
    expect(searchDevices(list, 'LECTERN', rooms).map((d) => d.id)).toEqual(['c'])
  })

  it('matches on the room name, accent-insensitively', () => {
    // "sal a" (no diacritics) matches room "Sál A".
    expect(searchDevices(list, 'sal a', rooms).map((d) => d.id)).toEqual(['a'])
  })

  it('matches on the type label', () => {
    expect(searchDevices(list, 'lights', rooms).map((d) => d.id)).toEqual(['b'])
  })

  it('requires every term to match (AND)', () => {
    expect(searchDevices(list, 'hall projector', rooms).map((d) => d.id)).toEqual(['a'])
    expect(searchDevices(list, 'hall mic', rooms)).toHaveLength(0)
  })
})

describe('groupDevices', () => {
  const list = [dev('a', 'audio', 'r2'), dev('b', 'video', 'r1'), dev('c', 'audio', null)]
  const rooms = [room('r1', 'Hall', 1), room('r2', 'Foyer', 0)]

  it('off → one untitled group + subgroup preserving order', () => {
    const groups = groupDevices(list, 'off', rooms)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toBeNull()
    expect(groups[0]!.subgroups).toHaveLength(1)
    expect(groups[0]!.subgroups[0]!.title).toBeNull()
    expect(groups[0]!.subgroups[0]!.devices.map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('type → alphabetical groups, each subgrouped by room', () => {
    const groups = groupDevices(list, 'type', rooms)
    expect(groups.map((g) => g.title)).toEqual(['Audio', 'Video'])
    // Audio group: rooms ordered by displayOrder (Foyer r2), unassigned last.
    expect(groups[0]!.subgroups.map((s) => s.title)).toEqual(['Foyer', 'Unassigned'])
    expect(groups[0]!.subgroups[0]!.devices.map((d) => d.id)).toEqual(['a'])
    expect(groups[0]!.subgroups[1]!.devices.map((d) => d.id)).toEqual(['c'])
  })

  it('room → ordered by displayOrder (unassigned last), each subgrouped by type', () => {
    const groups = groupDevices(list, 'room', rooms)
    expect(groups.map((g) => g.title)).toEqual(['Foyer', 'Hall', 'Unassigned'])
    expect(groups[0]!.subgroups.map((s) => s.title)).toEqual(['Audio'])
    expect(groups[0]!.subgroups[0]!.devices.map((d) => d.id)).toEqual(['a'])
    expect(groups[2]!.subgroups[0]!.devices.map((d) => d.id)).toEqual(['c'])
  })

  it('never emits empty (sub)groups after filtering', () => {
    const filtered = filterByTypes(list, ['video']) // only device b (Hall/video)
    const groups = groupDevices(filtered, 'room', rooms)
    expect(groups.map((g) => g.title)).toEqual(['Hall'])
    expect(groups[0]!.subgroups.map((s) => s.title)).toEqual(['Video'])
  })
})

describe('deviceKind — driver subtype → widget', () => {
  it('maps the Extron matrix output to the matrixOutput widget', () => {
    expect(deviceKind(makeDevice({ subtype: 'extron-matrix.output' }))).toBe('matrixOutput')
  })

  it('falls back to unsupported for unknown subtypes', () => {
    expect(deviceKind(makeDevice({ subtype: 'something.else' }))).toBe('unsupported')
  })
})

describe('readInt', () => {
  it('reads the first integer-valued key, else 0', () => {
    expect(readInt({ input: 5 }, 'input')).toBe(5)
    expect(readInt({ input: 0 }, 'input')).toBe(0)
    expect(readInt({}, 'input')).toBe(0)
    expect(readInt({ input: 1.5 }, 'input')).toBe(0) // non-integer ignored
  })
})

describe('matrixInputs', () => {
  it('uses connection-config labels (numbered) and prepends a None option', () => {
    const config = { inputCount: 2, inputs: ['Lectern', 'Laptop'] }
    expect(matrixInputs(config)).toEqual([
      { value: 0, label: 'None' },
      { value: 1, label: '1. Lectern' },
      { value: 2, label: '2. Laptop' },
    ])
  })

  it('falls back to "Input N" for unnamed inputs up to inputCount', () => {
    // 3 inputs declared, only the first two named.
    const inputs = matrixInputs({ inputCount: 3, inputs: ['Lectern'] })
    expect(inputs).toEqual([
      { value: 0, label: 'None' },
      { value: 1, label: '1. Lectern' },
      { value: 2, label: 'Input 2' },
      { value: 3, label: 'Input 3' },
    ])
  })

  it('generates "Input N" when config is empty, defaulting to 10 inputs', () => {
    const inputs = matrixInputs({})
    expect(inputs).toHaveLength(11) // None + 10
    expect(inputs[1]).toEqual({ value: 1, label: 'Input 1' })
    expect(inputs[10]).toEqual({ value: 10, label: 'Input 10' })
  })

  it('tolerates an undefined config', () => {
    expect(matrixInputs(undefined)).toHaveLength(11)
  })
})
