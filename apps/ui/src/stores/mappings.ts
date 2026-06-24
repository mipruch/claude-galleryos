/**
 * Mappings store — input-mapping rules (OSC/TCP/HTTP signal → action).
 *
 * Loads the rule list (`GET /api/v1/mappings`) and exposes create / update /
 * remove / toggle plus a `test` dry-run for the admin portal. There is no live
 * socket event for mappings, so views re-fetch on demand; this store holds the
 * latest snapshot. The server reloads its live InputMapper cache on every
 * mutation, so changes take effect without a restart.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type {
  InputMappingDTO,
  InputMappingCreateInput,
  InputMappingTestResult,
  InputMappingUpdateInput,
} from '@gallery/types'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

export const useMappingsStore = defineStore('mappings', () => {
  const records = ref<InputMappingDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Loads all mappings, newest first (server order). */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = (await api.mappings.list()) ?? []
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load mappings', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Insert or replace a row in place. */
  function replaceRecord(record: InputMappingDTO): void {
    const i = records.value.findIndex((m) => m.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.unshift(record)
  }

  /**
   * Creates a mapping.
   *
   * @returns The created row, or `null` on failure (an error toast is shown).
   */
  async function create(input: InputMappingCreateInput): Promise<InputMappingDTO | null> {
    try {
      const created = await api.mappings.create(input)
      if (created) replaceRecord(created)
      toast.success('Mapping created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create mapping', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates a mapping (the server reloads the live matcher cache).
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: InputMappingUpdateInput): Promise<boolean> {
    try {
      const updated = await api.mappings.update(id, input)
      if (updated) replaceRecord(updated)
      toast.success('Mapping updated')
      return true
    } catch (err) {
      toast.error('Could not update mapping', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Deletes a mapping.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.mappings.remove(id)
      records.value = records.value.filter((m) => m.id !== id)
      toast.success('Mapping deleted')
      return true
    } catch (err) {
      toast.error('Could not delete mapping', { description: errMsg(err) })
      return false
    }
  }

  /** Enable / disable a mapping without deleting it. */
  async function toggle(id: string, enabled: boolean): Promise<boolean> {
    try {
      const updated = await api.mappings.toggle(id, enabled)
      if (updated) replaceRecord(updated)
      return true
    } catch (err) {
      toast.error('Could not update mapping', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Dry-run a sample signal against the enabled rules (no dispatch).
   *
   * @returns The match result, or `null` on failure (an error toast is shown).
   */
  async function test(input: {
    protocol: string
    address: string
    args?: unknown[]
  }): Promise<InputMappingTestResult | null> {
    try {
      return (await api.mappings.test(input)) ?? null
    } catch (err) {
      toast.error('Could not test mapping', { description: errMsg(err) })
      return null
    }
  }

  return { records, loading, loaded, error, fetchAll, create, update, remove, toggle, test }
})
