/**
 * Cameras store — RTSP CCTV sources, one row per user-panel sidebar entry.
 *
 * Loads the list (`GET /api/v1/cameras`, credentials stripped server-side) and
 * holds the latest snapshot sorted by `displayOrder` so reads match the sidebar
 * order. There is no live socket event for cameras; the actual video is streamed
 * on demand by the `CameraView` component, not this store. Also exposes create /
 * update / remove / move for the admin portal.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { CameraDTO, CameraCreateInput, CameraUpdateInput } from '@gallery/types'
import { computeCameraReorder, sortByDisplayOrder } from '@/lib/cameras'
import { errMsg } from '@/lib/http'
import { logger } from '@/lib/logger'
import { api } from '@/lib/api'

const log = logger.child('cameras-store')

export const useCamerasStore = defineStore('cameras', () => {
  const records = ref<CameraDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Loads all cameras, sorted by display order. */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = sortByDisplayOrder((await api.cameras.list()) ?? [])
      loaded.value = true
      log.info('loaded cameras', { count: records.value.length })
    } catch (err) {
      error.value = errMsg(err)
      log.error('could not load cameras', { error: error.value })
      toast.error('Could not load cameras', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Look up a camera by id from the loaded snapshot. */
  function byId(id: string): CameraDTO | undefined {
    return records.value.find((c) => c.id === id)
  }

  /** Insert or replace a row, keeping the list ordered. */
  function replaceRecord(record: CameraDTO): void {
    const i = records.value.findIndex((c) => c.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
    records.value = sortByDisplayOrder(records.value)
  }

  /**
   * Creates a camera.
   *
   * @returns The created row, or `null` on failure (an error toast is shown).
   */
  async function create(input: CameraCreateInput): Promise<CameraDTO | null> {
    try {
      const created = await api.cameras.create(input)
      if (created) replaceRecord(created)
      toast.success('Camera created')
      return created ?? null
    } catch (err) {
      log.error('could not create camera', { error: errMsg(err) })
      toast.error('Could not create camera', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates a camera.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: CameraUpdateInput): Promise<boolean> {
    try {
      const updated = await api.cameras.update(id, input)
      if (updated) replaceRecord(updated)
      toast.success('Camera updated')
      return true
    } catch (err) {
      log.error('could not update camera', { id, error: errMsg(err) })
      toast.error('Could not update camera', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Deletes a camera.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.cameras.remove(id)
      records.value = records.value.filter((c) => c.id !== id)
      toast.success('Camera deleted')
      return true
    } catch (err) {
      log.error('could not delete camera', { id, error: errMsg(err) })
      toast.error('Could not delete camera', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Reorders a camera by one position (delta -1 up / +1 down), persisting only
   * the cameras whose `displayOrder` changed. Optimistic; reverts via refetch on error.
   */
  async function move(id: string, delta: number): Promise<void> {
    const result = computeCameraReorder(records.value, id, delta)
    if (!result || !result.changed.length) return

    for (const change of result.changed) {
      const camera = records.value.find((c) => c.id === change.id)
      if (camera) camera.displayOrder = change.displayOrder
    }
    records.value = sortByDisplayOrder(records.value)
    try {
      await Promise.all(
        result.changed.map((c) => api.cameras.update(c.id, { displayOrder: c.displayOrder })),
      )
    } catch (err) {
      log.error('could not reorder cameras', { error: errMsg(err) })
      toast.error('Could not reorder cameras', { description: errMsg(err) })
      await fetchAll()
    }
  }

  return { records, loading, loaded, error, fetchAll, byId, create, update, remove, move }
})
