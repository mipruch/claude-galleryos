/**
 * System store — overall server health and per-connection driver subprocess
 * status, for the admin dashboard.
 *
 * There is no live socket event for system health, so the dashboard re-fetches
 * on an interval; this store just exposes the latest snapshot plus a `refresh()`.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

interface SystemStatus {
  status: string
  uptimeMs: number
  installedDrivers: number
  connections: { running: number; connected: number }
}

interface DriverRuntimeStatus {
  connectionId: string
  driverId: string
  running: boolean
  connected: boolean
}

export const useSystemStore = defineStore('system', () => {
  const status = ref<SystemStatus | null>(null)
  const drivers = ref<DriverRuntimeStatus[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  /** Fetches health + driver status together; degrades gracefully on failure. */
  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [s, d] = await Promise.all([api.system.status(), api.system.drivers()])
      status.value = s
      drivers.value = d ?? []
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
    } finally {
      loading.value = false
    }
  }

  return { status, drivers, loading, loaded, error, refresh }
})
