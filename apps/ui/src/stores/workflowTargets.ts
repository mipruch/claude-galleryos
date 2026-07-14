/**
 * Workflow-targets store — the placed instances a trigger can fire (a scene
 * run, or a device command with its params). A scene/device may have any
 * number of these; each is independently positioned and configured, so e.g.
 * "turn on" and "turn off" can be two separate nodes wired from two triggers.
 *
 * Loads the full list (`GET /api/v1/workflow-targets`) once; the workflow
 * canvas renders every row unconditionally (existence on this table *is*
 * placement — there is no "unplaced" state to filter by), same pattern as
 * `mappings`/`schedules`. The server reloads its live InputMapper cache when a
 * mapping-owned wire's target is mutated, so edits take effect immediately.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { WorkflowTargetCreateInput, WorkflowTargetDTO, WorkflowTargetUpdateInput } from '@gallery/types'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

export const useWorkflowTargetsStore = defineStore('workflowTargets', () => {
  const records = ref<WorkflowTargetDTO[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Loads every workflow target, newest first (server order). */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = (await api.workflowTargets.list()) ?? []
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load workflow targets', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Insert or replace a row in place. */
  function replaceRecord(record: WorkflowTargetDTO): void {
    const i = records.value.findIndex((t) => t.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.unshift(record)
  }

  /**
   * Places a new instance (dragging a scene/device from the library onto the canvas).
   *
   * @returns The created row, or `null` on failure (an error toast is shown).
   */
  async function create(input: WorkflowTargetCreateInput): Promise<WorkflowTargetDTO | null> {
    try {
      const created = await api.workflowTargets.create(input)
      if (created) replaceRecord(created)
      return created ?? null
    } catch (err) {
      toast.error('Could not place instance', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates an instance's command/params/position.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: WorkflowTargetUpdateInput): Promise<boolean> {
    try {
      const updated = await api.workflowTargets.update(id, input)
      if (updated) replaceRecord(updated)
      return true
    } catch (err) {
      toast.error('Could not update instance', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Removes an instance (and, server-side, any trigger actions wired to it).
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.workflowTargets.remove(id)
      records.value = records.value.filter((t) => t.id !== id)
      return true
    } catch (err) {
      toast.error('Could not remove instance', { description: errMsg(err) })
      return false
    }
  }

  return { records, loading, loaded, error, fetchAll, create, update, remove }
})
