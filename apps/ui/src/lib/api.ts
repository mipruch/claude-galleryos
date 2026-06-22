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

import type {
  ConnectionDTO,
  ConnectionStatus,
  ConnectionWithRuntime,
  DeviceDTO,
  DeviceState,
  DeviceStatus,
  IframeDTO,
  Jsonify,
  LevelCount,
  LogDTO,
  RoomDTO,
  SceneCreateInput,
  SceneDTO,
  SceneExecution,
  ScheduledJobDTO,
  ScheduleNextRuns,
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

/** List-view of an installed driver manifest (`GET /drivers`). */
interface DriverManifestView {
  id: string
  name: string
  version: string
  vendor: string
  description?: string
  capabilities: { discovery: boolean; subscriptions: boolean; bidirectional: boolean }
  endpointTypes: Array<{ type: string; name: string }>
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
    create: (input: Partial<IframeDTO>) => post<IframeDTO>('/iframes', input),
    update: (id: string, patch: Partial<IframeDTO>) => put<IframeDTO>(`/iframes/${id}`, patch),
    remove: (id: string) => del(`/iframes/${id}`),
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
    /** Preview the next `count` (default 5) UTC fire times of a schedule. */
    next: (id: string, count?: number) => get<ScheduleNextRuns>(`/schedules/${id}/next${qs({ count })}`),
  },

  drivers: {
    list: () => get<DriverManifestView[]>('/drivers'),
    manifest: (id: string) => get<DriverManifestView>(`/drivers/${id}/manifest`),
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
