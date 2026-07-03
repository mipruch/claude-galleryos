/**
 * Cameras store — RTSP CCTV sources, one row per user-panel sidebar entry.
 *
 * Loads the list (`GET /api/v1/cameras`, credentials stripped server-side) and
 * holds the latest snapshot sorted by `displayOrder` so reads match the sidebar
 * order. There is no live socket event for cameras; the actual video is streamed
 * on demand by the `CameraView` component, not this store. CRUD lives in the API
 * client for a future admin page — the user UI only reads.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { CameraDTO } from '@gallery/types'
import { sortByDisplayOrder } from '@/lib/cameras'
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

  return { records, loading, loaded, error, fetchAll, byId }
})
