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

  /**
   * Fetches health + driver status together, degrading gracefully: each part
   * updates independently, so a partial outage (one endpoint down) still
   * refreshes the other instead of dropping both.
   */
  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    const [s, d] = await Promise.allSettled([api.system.status(), api.system.drivers()])
    if (s.status === 'fulfilled') status.value = s.value
    if (d.status === 'fulfilled') drivers.value = d.value ?? []
    const failed = [s, d].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (failed) error.value = errMsg(failed.reason)
    else loaded.value = true
    loading.value = false
  }

  return { status, drivers, loading, loaded, error, refresh }
})
