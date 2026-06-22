/**
 * Drivers store — caches the installed driver manifests (`GET /drivers`).
 *
 * Manifests are static, so they're fetched once and reused. The admin
 * connection/device forms read them to render dynamic, schema-driven fields
 * (`connectionSchema`, per-endpoint `addressSchema`, command `paramsSchema`).
 */
import type { DriverManifest, EndpointTypeDefinition } from '@gallery/driver-core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

export const useDriversStore = defineStore('drivers', () => {
  const manifests = ref<DriverManifest[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const byId = computed<Record<string, DriverManifest>>(() =>
    Object.fromEntries(manifests.value.map((m) => [m.id, m])),
  )

  /** Fetch manifests once; subsequent calls are no-ops unless `force`. */
  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    loading.value = true
    error.value = null
    try {
      manifests.value = (await api.drivers.list()) ?? []
      loaded.value = true
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load drivers', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  const get = (id: string | null | undefined): DriverManifest | undefined =>
    id ? byId.value[id] : undefined

  /** Endpoint types declared by a driver (for the device form's type select). */
  const endpointTypes = (driverId: string | null | undefined): EndpointTypeDefinition[] =>
    get(driverId)?.endpointTypes ?? []

  const endpointType = (
    driverId: string | null | undefined,
    type: string | null | undefined,
  ): EndpointTypeDefinition | undefined =>
    type ? endpointTypes(driverId).find((e) => e.type === type) : undefined

  return { manifests, loading, loaded, error, byId, load, get, endpointTypes, endpointType }
})
