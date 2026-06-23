import { describe, expect, it } from 'vitest'
import type { RoomDTO } from '@gallery/types'
import { computeReorder, sortRooms } from '@/lib/rooms'

const room = (id: string, displayOrder: number, name = id): RoomDTO =>
  ({ id, name, displayOrder }) as RoomDTO

describe('sortRooms', () => {
  it('orders by displayOrder then name', () => {
    const list = [room('c', 2, 'Cellar'), room('a', 0, 'Atrium'), room('b', 0, 'Balcony'), room('z', 0, 'Annex')]
    // displayOrder 0 group sorts by name: Annex(z), Atrium(a), Balcony(b); then Cellar(c).
    expect(sortRooms(list).map((r) => r.id)).toEqual(['z', 'a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    const list = [room('b', 1), room('a', 0)]
    const before = list.map((r) => r.id)
    sortRooms(list)
    expect(list.map((r) => r.id)).toEqual(before)
  })
})

describe('computeReorder', () => {
  it('moves a room down and reports only changed rooms', () => {
    const list = [room('a', 0), room('b', 1), room('c', 2)]
    const result = computeReorder(list, 'a', 1)
    expect(result?.order.map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(result?.changed).toEqual([
      { id: 'b', displayOrder: 0 },
      { id: 'a', displayOrder: 1 },
    ])
  })

  it('moves a room up', () => {
    const list = [room('a', 0), room('b', 1), room('c', 2)]
    const result = computeReorder(list, 'c', -1)
    expect(result?.order.map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })

  it('renumbers tied (all-zero) display orders on the first move', () => {
    const list = [room('a', 0, 'Alpha'), room('b', 0, 'Bravo'), room('c', 0, 'Charlie')]
    // sorted by name: a, b, c → move c up past b
    const result = computeReorder(list, 'c', -1)
    expect(result?.order.map((r) => r.id)).toEqual(['a', 'c', 'b'])
    expect(result?.changed).toEqual([
      { id: 'c', displayOrder: 1 },
      { id: 'b', displayOrder: 2 },
    ])
  })

  it('returns null at the edges or for an unknown id', () => {
    const list = [room('a', 0), room('b', 1)]
    expect(computeReorder(list, 'a', -1)).toBeNull()
    expect(computeReorder(list, 'b', 1)).toBeNull()
    expect(computeReorder(list, 'nope', 1)).toBeNull()
  })
})
