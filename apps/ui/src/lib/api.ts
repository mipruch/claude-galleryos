/**
 * Typed REST client — the one place that knows the GalleryOS HTTP surface.
 *
 * Every method is typed against the shared `@gallery/types` DTOs, so a change to
 * a server contract is a compile error here (and in the stores that call this),
 * instead of a silent runtime mismatch. Built on `fetchJson`, so responses still
 * surface the server's `ApiError.error` message on failure and `204` → `null`.
 *
 * Grouped by resource. The stores (`devices`, `connections`, `scenes`) call
 * these instead of hand-writing `fetch('/api/v1/…')`; the remaining groups
 * (rooms, iframes, drivers, logs, system) round out the surface for the admin UI.
 */

import type { DriverManifest } from '@gallery/driver-core'
import type {
  CameraDTO,
  CameraCreateInput,
  CameraUpdateInput,
  ConnectionDTO,
  ConnectionStatus,
  ConnectionWithRuntime,
  DeviceDTO,
  DeviceState,
  DeviceStatus,
  IframeDTO,
  IframeCreateInput,
  IframeUpdateInput,
  InputMappingDTO,
  InputMappingCreateInput,
  InputMappingUpdateInput,
  InputMappingTestResult,
  Jsonify,
  KioskDTO,
  KioskCreateInput,
  KioskUpdateInput,
  LevelCount,
  LogDTO,
  RoomDTO,
  SceneCreateInput,
  SceneDTO,
  SceneExecution,
  ScheduledJobDTO,
  ScheduleCreateInput,
  ScheduleNextRuns,
  ScheduleUpdateInput,
  SceneUpdateInput,
  SceneWithActionsDTO,
} from '@gallery/types'
import { fetchJson } from './http'

const API = '/api/v1'

// ── response shapes that aren't 1:1 DTOs ────────────────────────────────────

/** Outcome of a single device command (mirrors the driver-core CommandResult). */
interface CommandResult {
  success: boolean
  durationMs: number
  state?: DeviceState
  error?: string
}

/** `POST /scenes/:id/execute` → an accepted, asynchronously-running scene. */
interface SceneRunResult {
  executionId: string
  sceneId: string
  status: string
}

/** Live snapshot keyed by device id (`GET /devices/live`). */
type DeviceLiveMap = Record<string, { state: DeviceState; status: DeviceStatus }>

/** Per-connection driver subprocess status (`GET /system/drivers`). */
interface DriverRuntimeStatus {
  connectionId: string
  driverId: string
  running: boolean
  connected: boolean
}

/** Overall health (`GET /system/status`). */
interface SystemStatus {
  status: string
  uptimeMs: number
  installedDrivers: number
  connections: { running: number; connected: number }
}

type SceneExecutionDTO = Jsonify<SceneExecution>

// ── low-level verb helpers ──────────────────────────────────────────────────

const jsonInit = (method: string, body?: unknown): RequestInit =>
  body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }

const get = <T>(path: string) => fetchJson<T>(`${API}${path}`)
const post = <T>(path: string, body?: unknown) => fetchJson<T>(`${API}${path}`, jsonInit('POST', body))
const put = <T>(path: string, body?: unknown) => fetchJson<T>(`${API}${path}`, jsonInit('PUT', body))
const patch = <T>(path: string, body?: unknown) => fetchJson<T>(`${API}${path}`, jsonInit('PATCH', body))
const del = (path: string) => fetchJson<null>(`${API}${path}`, jsonInit('DELETE'))

type QueryValue = string | number | boolean | undefined
/**
 * Builds a URL query string from optional parameters.
 *
 * @returns A query string prefixed with `?`, or an empty string if no parameters are provided
 */
function qs(params?: Record<string, QueryValue>): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) sp.set(key, String(value))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

// ── resource groups ─────────────────────────────────────────────────────────

export const api = {
  devices: {
    list: (filter?: { roomId?: string; type?: string; enabled?: boolean; connectionId?: string }) =>
      get<DeviceDTO[]>(
        `/devices${qs({
          room_id: filter?.roomId,
          type: filter?.type,
          enabled: filter?.enabled,
          connection_id: filter?.connectionId,
        })}`,
      ),
    live: () => get<DeviceLiveMap>('/devices/live'),
    get: (id: string) => get<DeviceDTO>(`/devices/${id}`),
    create: (input: Partial<DeviceDTO>) => post<DeviceDTO>('/devices', input),
    update: (id: string, patch: Partial<DeviceDTO>) => put<DeviceDTO>(`/devices/${id}`, patch),
    remove: (id: string) => del(`/devices/${id}`),
    command: (id: string, command: string, params: Record<string, unknown> = {}) =>
      post<CommandResult>(`/devices/${id}/command`, { command, params }),
    state: (id: string) => get<DeviceState>(`/devices/${id}/state`),
    status: (id: string) => get<DeviceStatus>(`/devices/${id}/status`),
  },

  connections: {
    list: () => get<ConnectionWithRuntime[]>('/connections'),
    live: () => get<Record<string, ConnectionStatus>>('/connections/live'),
    get: (id: string) => get<ConnectionWithRuntime>(`/connections/${id}`),
    create: (input: Partial<ConnectionDTO>) => post<ConnectionWithRuntime>('/connections', input),
    update: (id: string, patch: Partial<ConnectionDTO>) =>
      put<ConnectionWithRuntime>(`/connections/${id}`, patch),
    remove: (id: string) => del(`/connections/${id}`),
    connect: (id: string) => post<{ connectionId: string; running: boolean }>(`/connections/${id}/connect`),
    disconnect: (id: string) =>
      post<{ connectionId: string; running: boolean }>(`/connections/${id}/disconnect`),
    status: (id: string) => get<ConnectionStatus>(`/connections/${id}/status`),
  },

  rooms: {
    list: () => get<RoomDTO[]>('/rooms'),
    get: (id: string) => get<RoomDTO>(`/rooms/${id}`),
    create: (input: Partial<RoomDTO>) => post<RoomDTO>('/rooms', input),
    update: (id: string, patch: Partial<RoomDTO>) => put<RoomDTO>(`/rooms/${id}`, patch),
    remove: (id: string) => del(`/rooms/${id}`),
  },

  iframes: {
    list: () => get<IframeDTO[]>('/iframes'),
    get: (id: string) => get<IframeDTO>(`/iframes/${id}`),
    create: (input: IframeCreateInput) => post<IframeDTO>('/iframes', input),
    update: (id: string, patch: IframeUpdateInput) => put<IframeDTO>(`/iframes/${id}`, patch),
    remove: (id: string) => del(`/iframes/${id}`),
  },

  cameras: {
    list: () => get<CameraDTO[]>('/cameras'),
    get: (id: string) => get<CameraDTO>(`/cameras/${id}`),
    create: (input: CameraCreateInput) => post<CameraDTO>('/cameras', input),
    update: (id: string, patch: CameraUpdateInput) => put<CameraDTO>(`/cameras/${id}`, patch),
    remove: (id: string) => del(`/cameras/${id}`),
  },

  kiosks: {
    list: () => get<KioskDTO[]>('/kiosks'),
    get: (id: string) => get<KioskDTO>(`/kiosks/${id}`),
    byName: (name: string) => get<KioskDTO>(`/kiosks/by-name/${encodeURIComponent(name)}`),
    byId: (id: string) => get<KioskDTO>(`/kiosks/${encodeURIComponent(id)}`),
    create: (input: KioskCreateInput) => post<KioskDTO>('/kiosks', input),
    update: (id: string, patch: KioskUpdateInput) => put<KioskDTO>(`/kiosks/${id}`, patch),
    remove: (id: string) => del(`/kiosks/${id}`),
  },

  scenes: {
    list: (filter?: { roomId?: string; isFavorite?: boolean; tags?: string[] }) =>
      get<SceneDTO[]>(
        `/scenes${qs({
          room_id: filter?.roomId,
          is_favorite: filter?.isFavorite,
          tags: filter?.tags?.join(','),
        })}`,
      ),
    get: (id: string) => get<SceneWithActionsDTO>(`/scenes/${id}`),
    create: (input: SceneCreateInput) => post<SceneWithActionsDTO>('/scenes', input),
    update: (id: string, input: SceneUpdateInput) => put<SceneWithActionsDTO>(`/scenes/${id}`, input),
    remove: (id: string) => del(`/scenes/${id}`),
    execute: (id: string, source = 'ui') => post<SceneRunResult>(`/scenes/${id}/execute`, { source }),
    dryRun: (id: string) => post<unknown>(`/scenes/${id}/execute/dry-run`),
    executions: (id: string) => get<SceneExecutionDTO[]>(`/scenes/${id}/executions`),
    setFavorite: (id: string, isFavorite: boolean) =>
      patch<SceneDTO>(`/scenes/${id}/favorite`, { is_favorite: isFavorite }),
  },

  schedules: {
    list: () => get<ScheduledJobDTO[]>('/schedules'),
    get: (id: string) => get<ScheduledJobDTO>(`/schedules/${id}`),
    create: (input: ScheduleCreateInput) => post<ScheduledJobDTO>('/schedules', input),
    update: (id: string, input: ScheduleUpdateInput) => put<ScheduledJobDTO>(`/schedules/${id}`, input),
    remove: (id: string) => del(`/schedules/${id}`),
    toggle: (id: string, enabled: boolean) =>
      patch<ScheduledJobDTO>(`/schedules/${id}/toggle`, { enabled }),
    /** Preview the next `count` (default 5) UTC fire times of a schedule. */
    next: (id: string, count?: number) => get<ScheduleNextRuns>(`/schedules/${id}/next${qs({ count })}`),
  },

  mappings: {
    list: (filter?: { protocol?: string; enabled?: boolean }) =>
      get<InputMappingDTO[]>(`/mappings${qs({ protocol: filter?.protocol, enabled: filter?.enabled })}`),
    get: (id: string) => get<InputMappingDTO>(`/mappings/${id}`),
    create: (input: InputMappingCreateInput) => post<InputMappingDTO>('/mappings', input),
    update: (id: string, input: InputMappingUpdateInput) => put<InputMappingDTO>(`/mappings/${id}`, input),
    remove: (id: string) => del(`/mappings/${id}`),
    toggle: (id: string, enabled: boolean) =>
      patch<InputMappingDTO>(`/mappings/${id}/toggle`, { enabled }),
    /** Dry-run a sample signal against the enabled rules (no dispatch). */
    test: (input: { protocol: string; address: string; args?: unknown[] }) =>
      post<InputMappingTestResult>('/mappings/test', input),
  },

  drivers: {
    // The server returns full manifests (schemas + endpoint types + commands),
    // which the admin connection/device forms need to render dynamic fields.
    list: () => get<DriverManifest[]>('/drivers'),
    manifest: (id: string) => get<DriverManifest>(`/drivers/${id}/manifest`),
  },

  logs: {
    list: (filter?: {
      level?: string
      source?: string
      entityId?: string
      from?: string
      to?: string
      limit?: number
      offset?: number
    }) =>
      get<{ logs: LogDTO[]; limit: number; offset: number; count: number }>(
        `/logs${qs({
          level: filter?.level,
          source: filter?.source,
          entity_id: filter?.entityId,
          from: filter?.from,
          to: filter?.to,
          limit: filter?.limit,
          offset: filter?.offset,
        })}`,
      ),
    stats: () =>
      get<{
        last24h: { since: string; byLevel: LevelCount[] }
        last7d: { since: string; byLevel: LevelCount[] }
      }>('/logs/stats'),
    executions: (filter?: { sceneId?: string; status?: string; limit?: number }) =>
      get<{ executions: SceneExecutionDTO[]; limit: number; count: number }>(
        `/logs/executions${qs({ scene_id: filter?.sceneId, status: filter?.status, limit: filter?.limit })}`,
      ),
  },

  system: {
    status: () => get<SystemStatus>('/system/status'),
    drivers: () => get<DriverRuntimeStatus[]>('/system/drivers'),
  },
}
