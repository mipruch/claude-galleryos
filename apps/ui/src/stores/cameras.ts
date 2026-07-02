/**
 * Cameras store — plain CRUD records for camera feed references.
 *
 * No control, no position: a camera row is just a name/description/icon plus
 * the feed URL and optional credentials. Loads the list (`GET /api/v1/cameras`)
 * and exposes create / update / remove for the admin portal.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { CameraDTO, CameraCreateInput, CameraUpdateInput } from '@gallery/types'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

function sortByName(list: CameraDTO[]): CameraDTO[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
}

export const useCamerasStore = defineStore('cameras', () => {
  const records = ref<CameraDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Loads all cameras, sorted by name. */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = sortByName((await api.cameras.list()) ?? [])
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load cameras', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Insert or replace a row, keeping the list ordered. */
  function replaceRecord(record: CameraDTO): void {
    const i = records.value.findIndex((c) => c.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
    records.value = sortByName(records.value)
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
      toast.error('Could not delete camera', { description: errMsg(err) })
      return false
    }
  }

  return { records, loading, loaded, error, fetchAll, create, update, remove }
})
