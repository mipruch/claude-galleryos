/**
 * Kiosks store — wall-screen / tablet layouts (the admin "Layouts" section).
 *
 * Loads the list (`GET /api/v1/kiosks`) and exposes create / update / remove for
 * the admin portal plus a `byName` lookup for the chromeless `/kiosk/:name`
 * viewer. There is no live socket event for kiosks (the *device* widgets inside
 * them update via the devices store), so views re-fetch on demand; this store
 * holds the latest snapshot, kept sorted by name.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { KioskCreateInput, KioskDTO, KioskUpdateInput } from '@gallery/types'
import { findKioskByName, sortKiosksByName } from '@/lib/kiosks'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

export const useKiosksStore = defineStore('kiosks', () => {
  const records = ref<KioskDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const kiosks = computed(() => records.value)

  /** Loads all kiosks, sorted by name. */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = sortKiosksByName((await api.kiosks.list()) ?? [])
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load layouts', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Insert or replace a row, keeping the list ordered. */
  function replaceRecord(record: KioskDTO): void {
    const i = records.value.findIndex((k) => k.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
    records.value = sortKiosksByName(records.value)
  }

  const byId = (id: string): KioskDTO | undefined => records.value.find((k) => k.id === id)
  const byName = (name: string): KioskDTO | undefined => findKioskByName(records.value, name)

  /**
   * Creates a kiosk.
   *
   * @returns The created row, or `null` on failure (an error toast is shown).
   */
  async function create(input: KioskCreateInput): Promise<KioskDTO | null> {
    try {
      const created = await api.kiosks.create(input)
      if (created) replaceRecord(created)
      toast.success('Layout created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create layout', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates a kiosk (metadata and/or grid config).
   *
   * @returns The updated row, or `null` on failure (an error toast is shown).
   */
  async function update(id: string, input: KioskUpdateInput): Promise<KioskDTO | null> {
    try {
      const updated = await api.kiosks.update(id, input)
      if (updated) replaceRecord(updated)
      return updated ?? null
    } catch (err) {
      toast.error('Could not save layout', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Deletes a kiosk.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.kiosks.remove(id)
      records.value = records.value.filter((k) => k.id !== id)
      toast.success('Layout deleted')
      return true
    } catch (err) {
      toast.error('Could not delete layout', { description: errMsg(err) })
      return false
    }
  }

  return { records, kiosks, loading, loaded, error, fetchAll, byId, byName, create, update, remove }
})
