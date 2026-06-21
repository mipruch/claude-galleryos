/**
 * Device store — single source of truth for the user UI.
 *
 * Hydrates every device + its Redis state/status over HTTP once (`init`), then
 * live-updates over the shared realtime socket (`stores/realtime`): `device:state`,
 * `device:online`, `device:offline`, `device:command:ack`. Control commands go back
 * over the same socket as `device:command`.
 */

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { IframeDTO, RoomDTO, ServerMessageData } from '@gallery/types'
import {
  applyRevert,
  deviceKind,
  deviceTypesOf,
  filterByRooms,
  filterByTypes,
  groupDevices,
  roomOptionsOf,
  searchDevices,
  snapshotState,
  type DeviceRecord,
  type DeviceState,
  type DeviceStatus,
  type GroupMode,
} from '@/lib/devices'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'
import { useRealtimeStore } from './realtime'

export const useDevicesStore = defineStore('devices', () => {
  const rt = useRealtimeStore()

  // ── reactive state ────────────────────────────────────────────────────────
  const records = ref<DeviceRecord[]>([])
  const rooms = ref<RoomDTO[]>([])
  const iframesList = ref<IframeDTO[]>([])
  const states = ref<Record<string, DeviceState>>({})
  const statuses = ref<Record<string, DeviceStatus>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  const connected = computed(() => rt.connected)

  // ── room scope (driven by the route; null = home / all devices) ───────────
  const roomScope = ref<string | null>(null)

  /** The room the current page is scoped to, if any. */
  const currentRoom = computed(() =>
    roomScope.value ? (rooms.value.find((r) => r.id === roomScope.value) ?? null) : null,
  )

  /** Renderable devices limited to the current room scope (all devices on home). */
  const scopedDevices = computed(() =>
    roomScope.value ? devices.value.filter((d) => d.roomId === roomScope.value) : devices.value,
  )

  /** Device count per room (across *all* devices) — for the sidebar badges. */
  const roomDeviceCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    for (const d of devices.value) {
      if (d.roomId) counts[d.roomId] = (counts[d.roomId] ?? 0) + 1
    }
    return counts
  })

  // ── view preferences (grouping + type/room filters + search) ──────────────
  const groupMode = ref<GroupMode>('off')
  const typeFilter = ref<string[]>([])
  const roomFilter = ref<string[]>([])
  const search = ref('')
  /** A non-blank search query overrides the chip filters (searches scoped devices). */
  const searching = computed(() => search.value.trim().length > 0)

  /** Point the grid at a room (or null for all). Resets view prefs on change. */
  function setRoomScope(roomId: string | null): void {
    if (roomScope.value === roomId) return
    roomScope.value = roomId
    groupMode.value = 'off'
    typeFilter.value = []
    roomFilter.value = []
    search.value = ''
  }

  // Devices we know how to render, sorted by the admin-defined display order.
  const devices = computed(() =>
    [...records.value]
      .filter((d) => d.enabled && deviceKind(d) !== 'unsupported')
      .sort((a, b) => a.displayOrder - b.displayOrder),
  )

  // Type/room options for the filter chips, each with a per-option device count.
  const deviceTypes = computed(() => deviceTypesOf(scopedDevices.value))
  const typeCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    for (const d of scopedDevices.value) counts[d.type] = (counts[d.type] ?? 0) + 1
    return counts
  })
  const roomOptions = computed(() => roomOptionsOf(scopedDevices.value, rooms.value))

  // Visible devices, then partitioned by group mode. While searching, the chip
  // filters are bypassed and the query runs across the scoped devices.
  const filteredDevices = computed(() =>
    searching.value
      ? searchDevices(scopedDevices.value, search.value, rooms.value)
      : filterByRooms(filterByTypes(scopedDevices.value, typeFilter.value), roomFilter.value),
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

  // ── live updates (registered on the shared socket) ────────────────────────
  rt.on('device:state', (d) => mergeState(d.deviceId, d.state))
  rt.on('device:online', (d) => setOnline(d.deviceId, true))
  rt.on('device:offline', (d) => setOnline(d.deviceId, false))
  rt.on('device:command:ack', onCommandAck)
  rt.on('driver:error', (d) => {
    if (d.message) toast.error('Driver error', { description: d.message })
  })

  function mergeState(id: string, patch: DeviceState): void {
    if (id) states.value[id] = { ...states.value[id], ...patch }
  }

  function setOnline(id: string, online: boolean): void {
    if (id) statuses.value[id] = { ...statusOf(id), online }
  }

  // ── command acknowledgements (optimistic confirm / revert) ─────────────────
  // Each in-flight command remembers the state it would revert to on failure and
  // a resolver for its sendCommand() promise. Acks are per-device and FIFO (the
  // server serialises commands per endpoint and the socket preserves order).
  interface PendingCommand {
    revert?: DeviceState
    resolve: (ok: boolean) => void
  }
  const pending = new Map<string, PendingCommand[]>()

  function enqueuePending(id: string, entry: PendingCommand): void {
    const queue = pending.get(id)
    if (queue) queue.push(entry)
    else pending.set(id, [entry])
  }

  /** Pop the oldest in-flight command for a device (FIFO). */
  function dequeuePending(id: string): PendingCommand | undefined {
    const queue = pending.get(id)
    const entry = queue?.shift()
    if (queue && queue.length === 0) pending.delete(id)
    return entry
  }

  const deviceName = (id: string): string =>
    records.value.find((r) => r.id === id)?.name ?? 'Device'

  function onCommandAck(d: ServerMessageData<'device:command:ack'>): void {
    const entry = dequeuePending(d.deviceId)
    if (!d.success) {
      if (entry?.revert) states.value[d.deviceId] = applyRevert(stateOf(d.deviceId), entry.revert)
      toast.error(`${deviceName(d.deviceId)}: command failed`, {
        description: d.error ?? 'Unknown error',
      })
    } else if (d.state) {
      // Authoritative post-command state (may correct a clamped optimistic value).
      mergeState(d.deviceId, d.state)
    }
    entry?.resolve(d.success)
  }

  // A dropped socket can never deliver outstanding acks — resolve them as failed
  // (without reverting: the command's true outcome is unknown) so awaiters don't
  // hang and stale acks can't mismatch after a reconnect.
  watch(connected, (isConnected) => {
    if (isConnected) return
    for (const queue of pending.values()) for (const entry of queue) entry.resolve(false)
    pending.clear()
  })

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
    rt.send({ event: 'device:state:patch', data: { deviceId: id, state: patch } })
  }

  // ── data loading ──────────────────────────────────────────────────────────
  async function init(): Promise<void> {
    await fetchAll()
  }

  async function fetchAll(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // The device list + one batched live snapshot ({ [id]: { state, status } })
      // + rooms (for the "group by room" headings), instead of 2×N per-device
      // fetches.
      const [list, live, roomList, iframeList] = await Promise.all([
        api.devices.list(),
        api.devices.live(),
        api.rooms.list(),
        api.iframes.list(),
      ])
      records.value = list ?? []
      rooms.value = roomList ?? []
      iframesList.value = [...(iframeList ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)
      for (const [id, snapshot] of Object.entries(live ?? {})) {
        if (snapshot.state) states.value[id] = snapshot.state
        if (snapshot.status) statuses.value[id] = snapshot.status
      }
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load devices', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  /**
   * Send a control command over the WebSocket and resolve to whether it
   * succeeded. `optimistic` is merged into the local state immediately for
   * instant feedback; the command then awaits the server's `device:command:ack`.
   * On failure the optimistic patch is rolled back and an error toast is shown.
   */
  function sendCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown> = {},
    optimistic?: DeviceState,
  ): Promise<boolean> {
    if (!connected.value) {
      toast.warning('Not connected', { description: 'Command was not sent (offline).' })
      return Promise.resolve(false)
    }
    const revert = optimistic ? snapshotState(stateOf(deviceId), optimistic) : undefined
    if (optimistic) mergeState(deviceId, optimistic)

    return new Promise<boolean>((resolve) => {
      enqueuePending(deviceId, { revert, resolve })
      rt.send({ event: 'device:command', data: { deviceId, command, params } })
    })
  }

  return {
    records,
    rooms,
    iframes: iframesList,
    states,
    statuses,
    loading,
    error,
    devices,
    connected,
    // room scope (routing)
    roomScope,
    currentRoom,
    scopedDevices,
    roomDeviceCounts,
    setRoomScope,
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
  }
})
