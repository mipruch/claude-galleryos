/**
 * Iframes store — embedded device UIs, one row per user-panel sidebar entry.
 *
 * Loads the list (`GET /api/v1/iframes`) and exposes create / update / remove
 * for the admin portal. There is no live socket event for iframes, so views
 * re-fetch on demand; this store holds the latest snapshot, kept sorted by
 * `displayOrder` so reads match the sidebar order.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { IframeDTO, IframeCreateInput, IframeUpdateInput } from '@gallery/types'
import { sortByDisplayOrder } from '@/lib/iframes'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

export const useIframesStore = defineStore('iframes', () => {
  const records = ref<IframeDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Loads all iframes, sorted by display order. */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = sortByDisplayOrder((await api.iframes.list()) ?? [])
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load iframes', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Insert or replace a row, keeping the list ordered. */
  function replaceRecord(record: IframeDTO): void {
    const i = records.value.findIndex((f) => f.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
    records.value = sortByDisplayOrder(records.value)
  }

  /**
   * Creates an iframe.
   *
   * @returns The created row, or `null` on failure (an error toast is shown).
   */
  async function create(input: IframeCreateInput): Promise<IframeDTO | null> {
    try {
      const created = await api.iframes.create(input)
      if (created) replaceRecord(created)
      toast.success('Iframe created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create iframe', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates an iframe.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: IframeUpdateInput): Promise<boolean> {
    try {
      const updated = await api.iframes.update(id, input)
      if (updated) replaceRecord(updated)
      toast.success('Iframe updated')
      return true
    } catch (err) {
      toast.error('Could not update iframe', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Deletes an iframe.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.iframes.remove(id)
      records.value = records.value.filter((f) => f.id !== id)
      toast.success('Iframe deleted')
      return true
    } catch (err) {
      toast.error('Could not delete iframe', { description: errMsg(err) })
      return false
    }
  }

  return { records, loading, loaded, error, fetchAll, create, update, remove }
})
