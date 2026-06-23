/**
 * Rooms store — the admin source of truth for room CRUD and ordering.
 *
 * Rooms group devices and scenes and drive the user sidebar. There's no live
 * socket event for rooms, so views fetch on mount; mutations update the local
 * list and toast on failure. Reordering (`move`) renumbers `displayOrder` and
 * persists only the rooms that changed.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { RoomDTO } from '@gallery/types'
import { computeReorder, sortRooms } from '@/lib/rooms'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

export const useRoomsStore = defineStore('rooms', () => {
  const records = ref<RoomDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Rooms in display order (what the table and sidebar render). */
  const ordered = computed<RoomDTO[]>(() => sortRooms(records.value))

  function replaceRecord(record: RoomDTO): void {
    const i = records.value.findIndex((r) => r.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
  }

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = (await api.rooms.list()) ?? []
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load rooms', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Fetch once; subsequent calls are no-ops unless `force`. */
  async function init(force = false): Promise<void> {
    if (loaded.value && !force) return
    await fetchAll()
  }

  /**
   * Creates a room (appended after the current last in display order).
   *
   * @returns The created room, or `null` on failure (an error toast is shown).
   */
  async function create(input: Partial<RoomDTO>): Promise<RoomDTO | null> {
    try {
      const created = await api.rooms.create({ displayOrder: records.value.length, ...input })
      if (created) replaceRecord(created)
      toast.success('Room created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create room', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates a room's metadata.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: Partial<RoomDTO>): Promise<boolean> {
    try {
      const updated = await api.rooms.update(id, input)
      if (updated) replaceRecord(updated)
      toast.success('Room updated')
      return true
    } catch (err) {
      toast.error('Could not update room', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Deletes a room. Devices/scenes that referenced it become unassigned
   * (the FK is `ON DELETE SET NULL`), so no cascade delete.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.rooms.remove(id)
      records.value = records.value.filter((r) => r.id !== id)
      toast.success('Room deleted')
      return true
    } catch (err) {
      toast.error('Could not delete room', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Reorders a room by one position (delta -1 up / +1 down), persisting only the
   * rooms whose `displayOrder` changed. Optimistic; reverts via refetch on error.
   */
  async function move(id: string, delta: number): Promise<void> {
    const result = computeReorder(records.value, id, delta)
    if (!result || !result.changed.length) return

    // Apply optimistically to the live records.
    for (const change of result.changed) {
      const room = records.value.find((r) => r.id === change.id)
      if (room) room.displayOrder = change.displayOrder
    }
    try {
      await Promise.all(
        result.changed.map((c) => api.rooms.update(c.id, { displayOrder: c.displayOrder })),
      )
    } catch (err) {
      toast.error('Could not reorder rooms', { description: errMsg(err) })
      await fetchAll() // resync from the server
    }
  }

  return { records, ordered, loading, loaded, error, init, fetchAll, create, update, remove, move }
})
