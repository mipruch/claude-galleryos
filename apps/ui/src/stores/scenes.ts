/**
 * Scenes store — the list of runnable scenes and one-tap execution.
 *
 * Scenes are loaded once over HTTP (`GET /api/v1/scenes`) and executed with
 * `POST /api/v1/scenes/:id/execute` (the server runs them asynchronously and
 * returns `202 { status: "running" }`). Live progress arrives over the same
 * WebSocket the devices store owns: `scene:started` / `scene:completed` /
 * `scene:failed` events flip the per-scene `running` flag (see the devices store,
 * which routes those events here). Any device state the scene changes is pushed
 * separately as `device:state`, so the device cards update on their own.
 *
 * Which scenes are *visible* follows the device grid's room filter and search box
 * (shared, single source of truth): no filter → all scenes; a room filter → only
 * that room's scenes; a non-blank search → scenes matching the query.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { SceneDTO } from '@gallery/types'
import { filterScenesByRooms, searchScenes } from '@/lib/scenes'
import { useDevicesStore } from './devices'

const API = '/api/v1'

export const useScenesStore = defineStore('scenes', () => {
  const devices = useDevicesStore()

  const records = ref<SceneDTO[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Scene ids currently executing (for spinner / disabled button feedback). */
  const running = ref<Record<string, boolean>>({})

  // Live progress: the devices store owns the socket and relays scene events
  // here (one-way dependency, no import cycle). Nested sub-scenes emit their own
  // events keyed by sceneId, so each clears its own running flag.
  devices.onSceneEvent((e) => {
    if (e.kind === 'started') markRunning(e.sceneId)
    else markFinished(e.sceneId, e.kind === 'failed' ? e.error : undefined)
  })

  // Enabled scenes, then filtered to match the grid: search overrides the room
  // filter (just like devices), otherwise the active room filter narrows them.
  const visibleScenes = computed<SceneDTO[]>(() => {
    const enabled = records.value.filter((s) => s.enabled)
    return devices.searching
      ? searchScenes(enabled, devices.search, devices.rooms)
      : filterScenesByRooms(enabled, devices.roomFilter)
  })

  const isRunning = (id: string): boolean => running.value[id] === true

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`${API}/scenes`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      records.value = (await res.json()) as SceneDTO[]
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      toast.error('Could not load scenes', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  const sceneName = (id: string): string => records.value.find((s) => s.id === id)?.name ?? 'Scene'

  /**
   * Trigger a scene run. Marks it running immediately for feedback; the WS
   * completion event clears that. A non-2xx response (e.g. 409 already running)
   * surfaces a toast and clears the flag right away.
   */
  async function execute(id: string): Promise<void> {
    running.value = { ...running.value, [id]: true }
    try {
      const res = await fetch(`${API}/scenes/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'ui' }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        const msg = body?.error?.message ?? `${res.status} ${res.statusText}`
        markFinished(id)
        toast.error(`${sceneName(id)}: could not run`, { description: msg })
        return
      }
      toast.success(sceneName(id), { description: 'Scene started' })
    } catch (err) {
      markFinished(id)
      toast.error(`${sceneName(id)}: could not run`, {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── WS-driven progress (called by the devices store's socket handler) ───────
  function markRunning(id: string): void {
    running.value = { ...running.value, [id]: true }
  }

  function markFinished(id: string, errorMessage?: string): void {
    const next = { ...running.value }
    delete next[id]
    running.value = next
    if (errorMessage) toast.error(`${sceneName(id)}: failed`, { description: errorMessage })
  }

  return {
    records,
    loading,
    error,
    running,
    visibleScenes,
    isRunning,
    fetchAll,
    execute,
    markRunning,
    markFinished,
  }
})
