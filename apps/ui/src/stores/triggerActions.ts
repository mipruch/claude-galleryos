/**
 * Trigger-actions store — what a schedule or mapping fires (0..N per trigger).
 *
 * Loads the full list (`GET /api/v1/trigger-actions`) once; the workflow canvas
 * filters client-side by `scheduleId`/`mappingId` when building the graph, same
 * pattern as `mappings`/`schedules`. The server reloads its live InputMapper
 * cache on a mapping-owned mutation, so wiring changes take effect immediately;
 * a schedule-owned one needs no such reload (the Scheduler fetches fresh per fire).
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { TriggerActionCreateInput, TriggerActionDTO, TriggerActionUpdateInput } from '@gallery/types'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

export const useTriggerActionsStore = defineStore('triggerActions', () => {
  const records = ref<TriggerActionDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Loads every trigger action, newest first (server order). */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = (await api.triggerActions.list()) ?? []
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load trigger actions', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Insert or replace a row in place. */
  function replaceRecord(record: TriggerActionDTO): void {
    const i = records.value.findIndex((a) => a.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.unshift(record)
  }

  /**
   * Creates a trigger action.
   *
   * @returns The created row, or `null` on failure (an error toast is shown).
   */
  async function create(input: TriggerActionCreateInput): Promise<TriggerActionDTO | null> {
    try {
      const created = await api.triggerActions.create(input)
      if (created) replaceRecord(created)
      return created ?? null
    } catch (err) {
      toast.error('Could not create trigger action', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates a trigger action.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: TriggerActionUpdateInput): Promise<boolean> {
    try {
      const updated = await api.triggerActions.update(id, input)
      if (updated) replaceRecord(updated)
      return true
    } catch (err) {
      toast.error('Could not update trigger action', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Deletes a trigger action.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.triggerActions.remove(id)
      records.value = records.value.filter((a) => a.id !== id)
      return true
    } catch (err) {
      toast.error('Could not delete trigger action', { description: errMsg(err) })
      return false
    }
  }

  return { records, loading, loaded, error, fetchAll, create, update, remove }
})
