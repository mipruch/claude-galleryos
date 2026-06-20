/**
 * Scenes store — the list of runnable scenes and one-tap execution.
 *
 * Scenes are loaded once over HTTP (`GET /api/v1/scenes`) and executed with
 * `POST /api/v1/scenes/:id/execute` (the server runs them asynchronously and
 * returns `202 { status: "running" }`). Live progress arrives over the shared
 * realtime socket: `scene:started` / `scene:completed` / `scene:failed` flip the
 * per-scene `running` flag. Any device state a scene changes is pushed separately
 * as `device:state`, so the device cards update on their own.
 *
 * Which scenes are *visible* follows the device grid's room filter and search box
 * (shared, single source of truth).
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { SceneDTO } from '@gallery/types'
import { filterScenesByRooms, searchScenes } from '@/lib/scenes'
import { errMsg, fetchJson } from '@/lib/http'
import { useDevicesStore } from './devices'
import { useRealtimeStore } from './realtime'

const API = '/api/v1'

export const useScenesStore = defineStore('scenes', () => {
  const devices = useDevicesStore()
  const rt = useRealtimeStore()

  const records = ref<SceneDTO[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Scene ids currently executing (for spinner / disabled button feedback). */
  const running = ref<Record<string, boolean>>({})

  // Live progress over the shared socket. Nested sub-scenes emit their own events
  // keyed by sceneId, so each clears its own running flag.
  rt.on('scene:started', (d) => markRunning(d.sceneId))
  rt.on('scene:completed', (d) => markFinished(d.sceneId))
  rt.on('scene:failed', (d) => markFinished(d.sceneId, d.error))

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
      records.value = (await fetchJson<SceneDTO[]>(`${API}/scenes`)) ?? []
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load scenes', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  const sceneName = (id: string): string => records.value.find((s) => s.id === id)?.name ?? 'Scene'

  /**
   * Trigger a scene run. Marks it running immediately for feedback; the WS
   * completion event clears that. A non-2xx response (e.g. 409 already running)
   * surfaces the server's message and clears the flag right away.
   */
  async function execute(id: string): Promise<void> {
    running.value = { ...running.value, [id]: true }
    try {
      await fetchJson(`${API}/scenes/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'ui' }),
      })
      toast.success(sceneName(id), { description: 'Scene started' })
    } catch (err) {
      markFinished(id)
      toast.error(`${sceneName(id)}: could not run`, { description: errMsg(err) })
    }
  }

  // ── WS-driven progress ──────────────────────────────────────────────────────
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
