/**
 * Schedules store — CRON jobs that run scenes on a timer.
 *
 * Loads the schedule list (`GET /api/v1/schedules`) and, for each *enabled* job,
 * a preview of its upcoming UTC fire times (`GET /api/v1/schedules/:id/next`).
 * There is no live socket event for schedules, so views re-fetch on demand; this
 * store exposes the latest snapshot.
 *
 * The user panel uses the read paths only (monitoring); the admin portal also
 * uses `create` / `update` / `remove` / `toggle` to manage jobs.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ScheduledJobDTO, ScheduleCreateInput, ScheduleUpdateInput } from '@gallery/types'
import { sortByNextRun } from '@/lib/schedules'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

/** How many upcoming runs to preview per schedule. */
const PREVIEW_COUNT = 5

export const useSchedulesStore = defineStore('schedules', () => {
  const records = ref<ScheduledJobDTO[]>([])
  /** Upcoming run times (ISO UTC) per schedule id, from the `/next` preview. */
  const previews = ref<Record<string, string[]>>({})
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Enabled schedules only, ordered by their soonest upcoming run. */
  const enabledSchedules = computed<ScheduledJobDTO[]>(() =>
    sortByNextRun(
      records.value.filter((s) => s.enabled),
      previews.value,
    ),
  )

  const previewsFor = (id: string): string[] => previews.value[id] ?? []

  /**
   * Loads schedules and the next-run preview for each enabled one. A failed
   * per-schedule preview degrades to an empty list rather than failing the page.
   */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const all = (await api.schedules.list()) ?? []
      records.value = all

      const enabled = all.filter((s) => s.enabled)
      const entries = await Promise.all(
        enabled.map(async (s): Promise<[string, string[]]> => {
          try {
            const res = await api.schedules.next(s.id, PREVIEW_COUNT)
            return [s.id, res?.nextRuns ?? []]
          } catch {
            return [s.id, []]
          }
        }),
      )
      previews.value = Object.fromEntries(entries)
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load schedules', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Insert or replace a schedule row and refresh its next-run preview. */
  function replaceRecord(record: ScheduledJobDTO): void {
    const i = records.value.findIndex((s) => s.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
    void refreshPreview(record)
  }

  /** Re-fetch one schedule's next-run preview (empty when disabled). */
  async function refreshPreview(record: ScheduledJobDTO): Promise<void> {
    if (!record.enabled) {
      previews.value = { ...previews.value, [record.id]: [] }
      return
    }
    try {
      const res = await api.schedules.next(record.id, PREVIEW_COUNT)
      previews.value = { ...previews.value, [record.id]: res?.nextRuns ?? [] }
    } catch {
      previews.value = { ...previews.value, [record.id]: [] }
    }
  }

  /**
   * Creates a schedule.
   *
   * @returns The created row, or `null` on failure (an error toast is shown).
   */
  async function create(input: ScheduleCreateInput): Promise<ScheduledJobDTO | null> {
    try {
      const created = await api.schedules.create(input)
      if (created) replaceRecord(created)
      toast.success('Schedule created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create schedule', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates a schedule (the server reloads the live timer).
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: ScheduleUpdateInput): Promise<boolean> {
    try {
      const updated = await api.schedules.update(id, input)
      if (updated) replaceRecord(updated)
      toast.success('Schedule updated')
      return true
    } catch (err) {
      toast.error('Could not update schedule', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Deletes a schedule (unregisters its timer).
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.schedules.remove(id)
      records.value = records.value.filter((s) => s.id !== id)
      toast.success('Schedule deleted')
      return true
    } catch (err) {
      toast.error('Could not delete schedule', { description: errMsg(err) })
      return false
    }
  }

  /** Enable / disable a schedule without deleting it. */
  async function toggle(id: string, enabled: boolean): Promise<boolean> {
    try {
      const updated = await api.schedules.toggle(id, enabled)
      if (updated) replaceRecord(updated)
      return true
    } catch (err) {
      toast.error('Could not update schedule', { description: errMsg(err) })
      return false
    }
  }

  return {
    records,
    previews,
    loading,
    loaded,
    error,
    enabledSchedules,
    previewsFor,
    fetchAll,
    create,
    update,
    remove,
    toggle,
  }
})
