import { describe, it, expect } from 'vitest'
import type { RoomDTO } from '@gallery/types'
import {
  deviceTypesOf,
  filterByRooms,
  filterByTypes,
  groupDevices,
  roomOptionsOf,
  typeLabel,
  type DeviceRecord,
} from '@/lib/devices'

/** Minimal device fixture — only the fields the grouping helpers read. */
function dev(id: string, type: string, roomId: string | null = null): DeviceRecord {
  return { id, name: id, type, roomId, displayOrder: 0 } as unknown as DeviceRecord
}

function room(id: string, name: string, displayOrder: number): RoomDTO {
  return { id, name, displayOrder } as unknown as RoomDTO
}

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
