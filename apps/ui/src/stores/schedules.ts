/**
 * Schedules store — read-only monitoring of enabled CRON schedules.
 *
 * Loads the schedule list (`GET /api/v1/schedules`) and, for each *enabled* job,
 * a preview of its upcoming UTC fire times (`GET /api/v1/schedules/:id/next`).
 * There is no live socket event for schedules, so the monitoring view re-fetches
 * periodically; this store just exposes the latest snapshot.
 *
 * This is monitoring only — the user UI never creates, edits, or toggles
 * schedules (that's the admin surface).
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ScheduledJobDTO } from '@gallery/types'
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

  return { records, previews, loading, loaded, error, enabledSchedules, previewsFor, fetchAll }
})
