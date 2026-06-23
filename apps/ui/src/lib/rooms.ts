/**
 * Room domain helpers for the admin rooms view. Pure and unit-tested so the
 * store stays a thin wrapper around the REST client.
 *
 * Rooms carry a `displayOrder` that drives both the admin list and the user
 * sidebar; reordering renumbers positions to contiguous 0..n-1 (which also
 * repairs ties, e.g. a freshly-seeded set where everything is `0`).
 */
import type { RoomDTO } from '@gallery/types'

/** Rooms by display order, then name as a stable tiebreaker. */
export function sortRooms(rooms: RoomDTO[]): RoomDTO[] {
  return [...rooms].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
}

/** A single room's new display order to persist. */
export interface OrderChange {
  id: string
  displayOrder: number
}

/**
 * Move room `id` by `delta` (-1 up / +1 down) within the ordered list and
 * renumber to contiguous positions.
 *
 * @returns the new ordered list plus the minimal set of rooms whose
 *   `displayOrder` actually changed, or `null` when the move is a no-op
 *   (unknown id, or already at an edge).
 */
export function computeReorder(
  rooms: RoomDTO[],
  id: string,
  delta: number,
): { order: RoomDTO[]; changed: OrderChange[] } | null {
  const sorted = sortRooms(rooms)
  const from = sorted.findIndex((r) => r.id === id)
  if (from < 0) return null
  const to = from + delta
  if (to < 0 || to >= sorted.length) return null

  const order = [...sorted]
  const [moved] = order.splice(from, 1)
  if (!moved) return null
  order.splice(to, 0, moved)

  const changed: OrderChange[] = []
  order.forEach((room, index) => {
    if (room.displayOrder !== index) changed.push({ id: room.id, displayOrder: index })
  })
  return { order, changed }
}
