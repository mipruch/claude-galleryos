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
import {
  connState,
  type ConnectionRecord,
  type ConnectionStatus,
  type ConnState,
} from '@/lib/connections'
import { errMsg, fetchJson } from '@/lib/http'
import { useRealtimeStore } from './realtime'

const API = '/api/v1'

/** A connection paired with its derived live state — what the UI renders. */
interface ConnectionView extends ConnectionRecord {
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

  // ── data loading ──────────────────────────────────────────────────────────
  async function init(): Promise<void> {
    await fetchAll()
  }

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [list, live] = await Promise.all([
        fetchJson<ConnectionRecord[]>(`${API}/connections`),
        fetchJson<Record<string, ConnectionStatus>>(`${API}/connections/live`),
      ])
      records.value = list ?? []
      statuses.value = live ?? {}
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load connections', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /** Enable/disable a connection (restarts or stops its driver subprocess). */
  async function setEnabled(id: string, value: boolean): Promise<void> {
    // Optimistic: flip the flag locally so the switch responds instantly.
    const before = records.value.find((c) => c.id === id)
    const snapshot = before ? { ...before } : null
    if (before) before.enabled = value

    try {
      const updated = await fetchJson<ConnectionRecord>(`${API}/connections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: value }),
      })
      if (updated) replaceRecord(updated)
    } catch (err) {
      // Revert on failure.
      if (snapshot) replaceRecord(snapshot)
      toast.error('Could not update connection', { description: errMsg(err) })
    }
  }

  function replaceRecord(record: ConnectionRecord): void {
    const i = records.value.findIndex((c) => c.id === record.id)
    if (i >= 0) records.value[i] = record
    else records.value.push(record)
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
  }
})
