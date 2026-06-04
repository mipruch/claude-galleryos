import { describe, it, expect } from 'vitest'
import type { RoomDTO } from '@gallery/types'
import {
  deviceTypesOf,
  filterByTypes,
  groupDevices,
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

describe('groupDevices', () => {
  const list = [dev('a', 'audio', 'r2'), dev('b', 'video', 'r1'), dev('c', 'audio', null)]
  const rooms = [room('r1', 'Hall', 1), room('r2', 'Foyer', 0)]

  it('off → one untitled group preserving order', () => {
    const groups = groupDevices(list, 'off', rooms)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toBeNull()
    expect(groups[0]!.devices.map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('type → alphabetical groups labelled by type', () => {
    const groups = groupDevices(list, 'type', rooms)
    expect(groups.map((g) => g.title)).toEqual(['Audio', 'Video'])
    expect(groups[0]!.devices.map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('room → ordered by displayOrder, unassigned last', () => {
    const groups = groupDevices(list, 'room', rooms)
    expect(groups.map((g) => g.title)).toEqual(['Foyer', 'Hall', 'Unassigned'])
    expect(groups[0]!.devices.map((d) => d.id)).toEqual(['a'])
    expect(groups[2]!.devices.map((d) => d.id)).toEqual(['c'])
  })
})
