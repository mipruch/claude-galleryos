/**
 * Connection store — drives the backend-connection status indicator.
 *
 *   1. `init()` fetches every connection + its Redis status over HTTP once.
 *   2. The shared realtime socket (`stores/realtime`) streams live changes:
 *      `connection:connected`, `connection:disconnected`, `driver:error`.
 *
 * Enabling / disabling a connection is a `PUT /connections/:id` which restarts
 * (or stops) its driver subprocess server-side; we adopt the returned row so the
 * `running` flag stays accurate.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ConnectionDTO } from '@gallery/types'
import {
  connState,
  type ConnectionRecord,
  type ConnectionStatus,
  type ConnState,
} from '@/lib/connections'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'
import { useRealtimeStore } from './realtime'

/** A connection paired with its derived live state — what the UI renders. */
export interface ConnectionView extends ConnectionRecord {
  status: ConnectionStatus
  state: ConnState
}

export const useConnectionsStore = defineStore('connections', () => {
  const rt = useRealtimeStore()

  // ── reactive state ────────────────────────────────────────────────────────
  const records = ref<ConnectionRecord[]>([])
  const statuses = ref<Record<string, ConnectionStatus>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  const realtime = computed(() => rt.connected)

  // ── live status updates (registered on the shared socket) ─────────────────
  rt.on('connection:connected', (d) => patchStatus(d.connectionId, { online: true, lastError: undefined }))
  rt.on('connection:disconnected', (d) => patchStatus(d.connectionId, { online: false, lastError: d.reason }))
  rt.on('driver:error', (d) => {
    if (d.connectionId) patchStatus(d.connectionId, { lastError: d.message })
  })

  /**
   * Merges a partial status update into the live status for a connection, defaulting to offline if no existing status is present.
   */
  function patchStatus(id: string, patch: Partial<ConnectionStatus>): void {
    if (!id) return
    statuses.value[id] = { ...(statuses.value[id] ?? { online: false }), ...patch }
  }

  // ── derived views & summary ───────────────────────────────────────────────
  const connections = computed<ConnectionView[]>(() =>
    [...records.value]
      .map((c) => {
        const status = statuses.value[c.id] ?? { online: false }
        return { ...c, status, state: connState(c, status) }
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const enabled = computed(() => connections.value.filter((c) => c.enabled))
  const connectedCount = computed(() => enabled.value.filter((c) => c.state === 'connected').length)
  const enabledCount = computed(() => enabled.value.length)

  /** "7/9" — connected vs total enabled connections. */
  const label = computed(() => `${connectedCount.value}/${enabledCount.value}`)

  /** Green only when every enabled connection is connected; red otherwise. */
  const allConnected = computed(
    () => enabledCount.value > 0 && connectedCount.value === enabledCount.value,
  )

  /**
   * Initializes the store by loading all connection records and their live statuses.
   */
  async function init(): Promise<void> {
    await fetchAll()
  }

  /**
   * Fetches and loads all connection records and live statuses.
   *
   * Displays an error toast if the fetch fails.
   */
  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [list, live] = await Promise.all([api.connections.list(), api.connections.live()])
      records.value = list ?? []
      statuses.value = live ?? {}
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load connections', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /**
   * Enables or disables a connection, restarting or stopping its driver.
   *
   * Optimistically updates the local state immediately. If the server update fails, reverts the change and displays an error message.
   *
   * @param id - The connection ID
   * @param value - Whether to enable (true) or disable (false) the connection
   */
  async function setEnabled(id: string, value: boolean): Promise<void> {
    // Optimistic: flip the flag locally so the switch responds instantly.
    const before = records.value.find((c) => c.id === id)
    const snapshot = before ? { ...before } : null
    if (before) before.enabled = value

    try {
      const updated = await api.connections.update(id, { enabled: value })
      if (updated) replaceRecord(updated)
    } catch (err) {
      // Revert on failure.
      if (snapshot) replaceRecord(snapshot)
      toast.error('Could not update connection', { description: errMsg(err) })
    }
  }

  /**
   * Adds a connection record or updates an existing one by ID.
   *
   * @param record - The connection record to add or update.
   */
  function replaceRecord(record: ConnectionRecord): void {
    const i = records.value.findIndex((c) => c.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
  }

  /**
   * Creates a connection (the server starts its driver subprocess when enabled).
   *
   * @returns The created row, or `null` on failure (an error toast is shown).
   */
  async function create(input: Partial<ConnectionDTO>): Promise<ConnectionRecord | null> {
    try {
      const created = await api.connections.create(input)
      if (created) replaceRecord(created)
      toast.success('Connection created')
      return created ?? null
    } catch (err) {
      toast.error('Could not create connection', { description: errMsg(err) })
      return null
    }
  }

  /**
   * Updates a connection; the server restarts its driver so config changes apply.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function update(id: string, input: Partial<ConnectionDTO>): Promise<boolean> {
    try {
      const updated = await api.connections.update(id, input)
      if (updated) replaceRecord(updated)
      toast.success('Connection updated')
      return true
    } catch (err) {
      toast.error('Could not update connection', { description: errMsg(err) })
      return false
    }
  }

  /**
   * Deletes a connection. Blocked server-side (409) while devices still use it.
   *
   * @returns `true` on success, `false` on failure (an error toast is shown).
   */
  async function remove(id: string): Promise<boolean> {
    try {
      await api.connections.remove(id)
      records.value = records.value.filter((c) => c.id !== id)
      toast.success('Connection deleted')
      return true
    } catch (err) {
      toast.error('Could not delete connection', { description: errMsg(err) })
      return false
    }
  }

  return {
    records,
    statuses,
    loading,
    error,
    realtime,
    connections,
    connectedCount,
    enabledCount,
    label,
    allConnected,
    init,
    fetchAll,
    setEnabled,
    create,
    update,
    remove,
  }
})
