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
import type { SceneCreateInput, SceneDTO, SceneUpdateInput, SceneWithActionsDTO } from '@gallery/types'
import { filterScenesByRooms, searchScenes } from '@/lib/scenes'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'
import { useDevicesStore } from './devices'
import { useRealtimeStore } from './realtime'

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

  /**
   * Fetches all scenes from the server and updates the store.
   *
   * If the fetch fails, displays an error toast with the failure reason.
   */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      records.value = (await api.scenes.list()) ?? []
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load scenes', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  const sceneName = (id: string): string => records.value.find((s) => s.id === id)?.name ?? 'Scene'

  /**
   * Executes a scene and displays feedback on success or failure.
   *
   * @param id - The scene ID to execute
   */
  async function execute(id: string): Promise<void> {
    running.value = { ...running.value, [id]: true }
    try {
      await api.scenes.execute(id, 'ui')
      toast.success(sceneName(id), { description: 'Scene started' })
    } catch (err) {
      markFinished(id)
      toast.error(`${sceneName(id)}: could not run`, { description: errMsg(err) })
    }
  }

  /**
   * Marks a scene as running in the execution progress state.
   *
   * @param id - The ID of the scene being executed
   */
  function markRunning(id: string): void {
    running.value = { ...running.value, [id]: true }
  }

  function markFinished(id: string, errorMessage?: string): void {
    const next = { ...running.value }
    delete next[id]
    running.value = next
    if (errorMessage) toast.error(`${sceneName(id)}: failed`, { description: errorMessage })
  }

  // ── admin CRUD ──────────────────────────────────────────────────────────────

  /** Insert or replace a scene row (the list carries the `SceneDTO` subset). */
  function replaceRecord(record: SceneDTO): void {
    const i = records.value.findIndex((s) => s.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
  }

  /** Fetch one scene *with* its ordered actions (for the editor). */
  async function getOne(id: string): Promise<SceneWithActionsDTO | null> {
    try {
      return (await api.scenes.get(id)) ?? null
    } catch (err) {
      toast.error('Could not load scene', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Creates a scene with its actions.
   *
   * @returns The created scene, or `null` on failure (an error toast is shown).
   */
  async function create(input: SceneCreateInput): Promise<SceneWithActionsDTO | null> {
    try {
      const created = await api.scenes.create(input)
      if (created) replaceRecord(created)
      toast.success('Scene created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create scene', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates a scene and/or its actions.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: SceneUpdateInput): Promise<boolean> {
    try {
      const updated = await api.scenes.update(id, input)
      if (updated) replaceRecord(updated)
      toast.success('Scene updated')
      return true
    } catch (err) {
      toast.error('Could not update scene', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Deletes a scene.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.scenes.remove(id)
      records.value = records.value.filter((s) => s.id !== id)
      toast.success('Scene deleted')
      return true
    } catch (err) {
      toast.error('Could not delete scene', { description: errMsg(err) })
      return false
    }
  }

  /** Toggle a scene's favourite flag (optimistic, reverts on failure). */
  async function setFavorite(id: string, isFavorite: boolean): Promise<void> {
    const scene = records.value.find((s) => s.id === id)
    if (scene) scene.isFavorite = isFavorite
    try {
      await api.scenes.setFavorite(id, isFavorite)
    } catch (err) {
      if (scene) scene.isFavorite = !isFavorite
      toast.error('Could not update favourite', { description: errMsg(err) })
    }
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
    getOne,
    create,
    update,
    remove,
    setFavorite,
  }
})
