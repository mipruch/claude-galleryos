/**
 * Device store — single source of truth for the user UI.
 *
 * Lifecycle (see README §9 for the WS protocol):
 *   1. `init()` fetches every device + its Redis state/status over HTTP once.
 *   2. A WebSocket (`/ws`) then streams live changes: `device:state`,
 *      `device:online`, `device:offline`.
 *   3. Control commands go *back* over the same socket as `device:command`.
 *
 * The native Bun WS uses a JSON envelope: `{ event, data }`.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useWebSocket } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { RoomDTO, ServerEvent, ServerMessage, ServerMessageData } from '@gallery/types'
import {
  deviceKind,
  deviceTypesOf,
  filterByRooms,
  filterByTypes,
  groupDevices,
  roomOptionsOf,
  searchDevices,
  type DeviceRecord,
  type DeviceState,
  type DeviceStatus,
  type GroupMode,
} from '@/lib/devices'

const API = '/api/v1'

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export const useDevicesStore = defineStore('devices', () => {
  // ── reactive state ────────────────────────────────────────────────────────
  const records = ref<DeviceRecord[]>([])
  const rooms = ref<RoomDTO[]>([])
  const states = ref<Record<string, DeviceState>>({})
  const statuses = ref<Record<string, DeviceStatus>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ── view preferences (grouping + type/room filters + search) ──────────────
  const groupMode = ref<GroupMode>('off')
  const typeFilter = ref<string[]>([])
  const roomFilter = ref<string[]>([])
  const search = ref('')
  /** A non-blank search query overrides the chip filters (searches all devices). */
  const searching = computed(() => search.value.trim().length > 0)

  // Devices we know how to render, sorted by the admin-defined display order.
  const devices = computed(() =>
    [...records.value]
      .filter((d) => d.enabled && deviceKind(d) !== 'unsupported')
      .sort((a, b) => a.displayOrder - b.displayOrder),
  )

  // Type/room options for the filter chips, each with a per-option device count.
  const deviceTypes = computed(() => deviceTypesOf(devices.value))
  const typeCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    for (const d of devices.value) counts[d.type] = (counts[d.type] ?? 0) + 1
    return counts
  })
  const roomOptions = computed(() => roomOptionsOf(devices.value, rooms.value))

  // Visible devices, then partitioned by group mode. While searching, the chip
  // filters are bypassed and the query runs across every enabled device.
  const filteredDevices = computed(() =>
    searching.value
      ? searchDevices(devices.value, search.value, rooms.value)
      : filterByRooms(filterByTypes(devices.value, typeFilter.value), roomFilter.value),
  )
  const groups = computed(() => groupDevices(filteredDevices.value, groupMode.value, rooms.value))

  function setGroupMode(mode: GroupMode): void {
    groupMode.value = mode
  }

  /** Toggle a value in a multi-select filter (empty selection = show all). */
  function toggleIn(filter: typeof typeFilter, value: string): void {
    const i = filter.value.indexOf(value)
    if (i >= 0) filter.value.splice(i, 1)
    else filter.value.push(value)
  }

  const toggleType = (type: string): void => toggleIn(typeFilter, type)
  const toggleRoom = (roomKey: string): void => toggleIn(roomFilter, roomKey)

  function clearTypeFilter(): void {
    typeFilter.value = []
  }
  function clearRoomFilter(): void {
    roomFilter.value = []
  }

  const stateOf = (id: string): DeviceState => states.value[id] ?? {}
  const statusOf = (id: string): DeviceStatus => statuses.value[id] ?? { online: false }

  // ── WebSocket (live updates + outgoing commands) ──────────────────────────
  const { status, send, open, close } = useWebSocket(wsUrl(), {
    immediate: false,
    autoReconnect: { retries: -1, delay: 2000 },
    onMessage: (_ws, ev) => handleMessage(ev.data),
  })
  const connected = computed(() => status.value === 'OPEN')

  // Map of server → client events to their handlers (README §9). Each `data` is
  // narrowed to that event's payload via the shared `ServerMessageData<E>`.
  const handlers: { [E in ServerEvent]?: (data: ServerMessageData<E>) => void } = {
    'device:state': (d) => mergeState(d.deviceId, d.state),
    'device:online': (d) => setOnline(d.deviceId, true),
    'device:offline': (d) => setOnline(d.deviceId, false),
    'driver:error': (d) => {
      if (d.message) toast.error('Driver error', { description: d.message })
    },
  }

  function handleMessage(raw: unknown): void {
    const msg = parseEnvelope(raw)
    if (!msg) return
    // The dynamic event→handler lookup can't preserve the event/data correlation;
    // each handler body is still fully typed by the map above.
    ;(handlers[msg.event] as ((data: unknown) => void) | undefined)?.(msg.data)
  }

  function mergeState(id: string, patch: DeviceState): void {
    if (id) states.value[id] = { ...states.value[id], ...patch }
  }

  function setOnline(id: string, online: boolean): void {
    if (id) statuses.value[id] = { ...statusOf(id), online }
  }

  /** Optimistic local merge — used while dragging, before a command is sent. */
  function patchState(id: string, patch: DeviceState): void {
    mergeState(id, patch)
  }

  /**
   * Persist a state patch to Redis (via WS) and broadcast to all UIs, without
   * executing any driver command. Use this to store "desired" values that should
   * survive page reloads and be visible to other connected clients — e.g. the
   * intended brightness while a DALI light is off.
   */
  function patchDeviceState(id: string, patch: DeviceState): void {
    mergeState(id, patch) // optimistic local
    if (!connected.value) return
    send(JSON.stringify({ event: 'device:state:patch', data: { deviceId: id, state: patch } }))
  }

  // ── data loading ──────────────────────────────────────────────────────────
  async function init(): Promise<void> {
    await fetchAll()
    open()
  }

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // The device list + one batched live snapshot ({ [id]: { state, status } })
      // + rooms (for the "group by room" headings), instead of 2×N per-device
      // fetches.
      const [list, live, roomList] = await Promise.all([
        fetchJson<DeviceRecord[]>(`${API}/devices`),
        fetchJson<Record<string, { state: DeviceState; status: DeviceStatus }>>(
          `${API}/devices/live`,
        ),
        fetchJson<RoomDTO[]>(`${API}/rooms`),
      ])
      records.value = list ?? []
      rooms.value = roomList ?? []
      for (const [id, snapshot] of Object.entries(live ?? {})) {
        if (snapshot.state) states.value[id] = snapshot.state
        if (snapshot.status) statuses.value[id] = snapshot.status
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      toast.error('Could not load devices', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /**
   * Send a control command over the WebSocket. `optimistic` is merged into the
   * local state immediately so the control reflects the change without waiting
   * for the round-trip; the authoritative value arrives via `device:state`.
   */
  function sendCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown> = {},
    optimistic?: DeviceState,
  ): void {
    if (optimistic) mergeState(deviceId, optimistic)
    if (!connected.value) {
      toast.warning('Not connected', { description: 'Command was not sent (offline).' })
      return
    }
    send(JSON.stringify({ event: 'device:command', data: { deviceId, command, params } }))
  }

  function dispose(): void {
    close()
  }

  return {
    records,
    rooms,
    states,
    statuses,
    loading,
    error,
    devices,
    connected,
    // grouping + filtering + search
    groupMode,
    typeFilter,
    roomFilter,
    search,
    searching,
    deviceTypes,
    typeCounts,
    roomOptions,
    filteredDevices,
    groups,
    setGroupMode,
    toggleType,
    toggleRoom,
    clearTypeFilter,
    clearRoomFilter,
    // lookups + lifecycle
    stateOf,
    statusOf,
    init,
    fetchAll,
    sendCommand,
    patchState,
    patchDeviceState,
    dispose,
  }
})

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`)
  return (await res.json()) as T
}

function parseEnvelope(raw: unknown): ServerMessage | null {
  try {
    return JSON.parse(String(raw)) as ServerMessage
  } catch {
    return null
  }
}
