/**
 * Record types — inferred straight from the Drizzle schema (single source of
 * truth) plus the JSON-wire DTOs the REST API actually returns.
 *
 * Two flavours per table:
 *   - `Connection`     — the in-memory row (Drizzle `$inferSelect`); `Date` dates.
 *                        Used by the server (repositories, core).
 *   - `ConnectionDTO`  — `Jsonify<Connection>`; `Date → string`. The exact shape
 *                        that crosses HTTP, used by the UI.
 *
 * `New*` types are insert shapes (`$inferInsert`) for repository writes.
 */

import type { Jsonify } from "./json.ts";
import type { CanvasPosition } from "./canvas.ts";
import type { InputProtocol, InputTargetType, OnFailure } from "./enums.ts";
import type { KioskConfig } from "./kiosk.ts";
import {
  cameras,
  connections,
  devices,
  iframes,
  inputMappings,
  kiosks,
  logs,
  roles,
  rooms,
  sceneActions,
  sceneExecutions,
  scenes,
  scheduledJobs,
  users,
} from "./schema.ts";

// ── in-memory rows (server side) ─────────────────────────────
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type Room = typeof rooms.$inferSelect;
export type Scene = typeof scenes.$inferSelect;
export type SceneAction = typeof sceneActions.$inferSelect;
export type SceneExecution = typeof sceneExecutions.$inferSelect;
export type LogRow = typeof logs.$inferInsert;
export type Iframe = typeof iframes.$inferSelect;
export type NewIframe = typeof iframes.$inferInsert;
export type Kiosk = typeof kiosks.$inferSelect;
export type NewKiosk = typeof kiosks.$inferInsert;
export type Camera = typeof cameras.$inferSelect;
export type NewCamera = typeof cameras.$inferInsert;
export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;
export type InputMapping = typeof inputMappings.$inferSelect;
export type NewInputMapping = typeof inputMappings.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/** A role plus the device ids it's allowed to see (joined from `role_devices`). */
export type RoleWithDevices = Role & { deviceIds: string[] };

/** A scene plus its ordered actions — the shape `scenesRepo.get` returns. */
export type SceneWithActions = Scene & { actions: SceneAction[] };

// ── JSON wire DTOs (what the REST API returns; UI side) ──────
export type RoomDTO = Jsonify<Room>;
export type ConnectionDTO = Jsonify<Connection>;
export type DeviceDTO = Jsonify<Device>;
export type SceneDTO = Jsonify<Scene>;
export type SceneActionDTO = Jsonify<SceneAction>;
export type SceneWithActionsDTO = Jsonify<SceneWithActions>;
export type LogDTO = Jsonify<typeof logs.$inferSelect>;
export type IframeDTO = Jsonify<Iframe>;
export type KioskDTO = Jsonify<Kiosk>;
/**
 * A camera as the REST API exposes it: the serialized row with `username` and
 * `password` stripped. RTSP credentials live only on the server (ffmpeg injects
 * them when connecting) and must never cross the wire to the browser.
 */
export type CameraDTO = Omit<Jsonify<Camera>, "username" | "password">;
export type ScheduledJobDTO = Jsonify<ScheduledJob>;
export type InputMappingDTO = Jsonify<InputMapping>;
export type RoleDTO = Jsonify<RoleWithDevices>;
/**
 * A user as the REST API exposes it: the serialized row with `passwordHash`
 * stripped — it never crosses the wire, even to the admin who created it.
 */
export type UserDTO = Omit<Jsonify<User>, "passwordHash">;

/**
 * A connection as `GET /connections` returns it: the serialized row plus the
 * live `running` flag attached from the DriverHost pool (not a DB column).
 */
export type ConnectionWithRuntime = ConnectionDTO & { running: boolean };

// ── request bodies (API inputs; shared so FE forms stay in sync) ──

/**
 * One action of a scene, as accepted by scene create/update.
 *
 * An action targets EITHER a device (`deviceId` + `command`) OR another scene
 * (`childSceneId`) — the latter runs that scene as a step ("scene composition").
 * Exactly one target must be set.
 */
export interface SceneActionInput {
  /** Device action target. Mutually exclusive with `childSceneId`. */
  deviceId?: string;
  /** Required for device actions; omit for sub-scene actions. */
  command?: string;
  /** Sub-scene action target: run this scene as a step. Mutually exclusive with `deviceId`. */
  childSceneId?: string;
  params?: Record<string, unknown>;
  /** Defaults to the action's position in the array if omitted. */
  stepOrder?: number;
  /** Actions in the same group run concurrently; groups run in ascending order. */
  parallelGroup?: number;
  /** Delay (ms) applied before this action runs. */
  delayMs?: number;
  /** "continue" (default) or "abort". */
  onFailure?: OnFailure;
  /** Node position on the scene's workflow canvas. Omit to leave unchanged. */
  position?: CanvasPosition | null;
}

export interface SceneCreateInput {
  name: string;
  roomId?: string | null;
  description?: string;
  icon?: string;
  color?: string;
  tags?: string[];
  isFavorite?: boolean;
  actions?: SceneActionInput[];
}

export type SceneUpdateInput = Partial<SceneCreateInput>;

// ── schedules (CRON jobs) ────────────────────────────────────

/** Body accepted by `POST /schedules`. */
export interface ScheduleCreateInput {
  name: string;
  sceneId: string;
  /** 5-field cron expression, interpreted in `timezone`. */
  cron: string;
  /** IANA timezone (e.g. "Europe/Prague"). Defaults server-side if omitted. */
  timezone?: string;
  enabled?: boolean;
  /** Node position on the workflow routing-map canvas. Omit to leave unchanged. */
  position?: CanvasPosition | null;
}

export type ScheduleUpdateInput = Partial<ScheduleCreateInput>;

// ── iframes (embedded device UIs) ────────────────────────────

/** Body accepted by `POST /iframes` — one embedded UI / sidebar entry. */
export interface IframeCreateInput {
  name: string;
  url: string;
  /** Sidebar sort position (ascending). Defaults to 0 server-side. */
  displayOrder?: number;
}

export type IframeUpdateInput = Partial<IframeCreateInput>;

// ── cameras (RTSP CCTV sources) ──────────────────────────────

/**
 * Body accepted by `POST /cameras` — one RTSP camera / sidebar live view.
 *
 * `url` is the RTSP base WITHOUT credentials (`rtsp://host:port/path`);
 * `username`/`password` are stored separately and injected server-side when
 * ffmpeg connects, so they are never echoed back to the browser.
 */
export interface CameraCreateInput {
  name: string;
  url: string;
  username?: string | null;
  password?: string | null;
  /** Sidebar sort position (ascending). Defaults to 0 server-side. */
  displayOrder?: number;
  /** Whether the camera is selectable in the UI. Defaults to true. */
  enabled?: boolean;
}

export type CameraUpdateInput = Partial<CameraCreateInput>;

// ── input mappings (OSC/TCP/HTTP ingress → action) ───────────

/**
 * Body accepted by `POST /mappings` — one rule mapping an incoming signal to an
 * action.
 *
 * A `pattern` matches the signal address: either exact (`/scene/execute`) or
 * parameterised with `:name` segments (`/dim/:level`), the latter capturing the
 * matched segment for use in `paramsTemplate`.
 *
 * `paramsTemplate` values are either literals (passed through unchanged) or
 * reference tokens substituted from the signal: `{arg[0]}` for the Nth positional
 * argument, `{:name}` for a captured path param. A value that is exactly one token
 * keeps the referenced value's type; a token embedded in a larger string
 * interpolates as text.
 *
 * `targetId`/`targetCommand` requirements depend on `targetType`:
 *   - `scene.execute`  → `targetId` = scene id (no command)
 *   - `device.command` → `targetId` = device id + `targetCommand`
 *   - `event.emit`     → neither required (the mapping name identifies the event)
 */
export interface InputMappingCreateInput {
  name: string;
  protocol: InputProtocol;
  pattern: string;
  targetType: InputTargetType;
  targetId?: string | null;
  targetCommand?: string | null;
  paramsTemplate?: Record<string, unknown>;
  enabled?: boolean;
  /** Node position on the workflow routing-map canvas. Omit to leave unchanged. */
  position?: CanvasPosition | null;
}

export type InputMappingUpdateInput = Partial<InputMappingCreateInput>;

/**
 * Result of `POST /mappings/test` — a dry-run that matches a sample signal
 * against the enabled mappings without dispatching anything. Each match reports
 * the rule that fired, the path params captured from `:name` segments, and the
 * params after applying `paramsTemplate`.
 */
export interface InputMappingTestResult {
  matched: boolean;
  matches: Array<{
    id: string;
    name: string;
    targetType: InputTargetType;
    targetId: string | null;
    targetCommand: string | null;
    pathParams: Record<string, string>;
    params: Record<string, unknown>;
  }>;
}

// ── kiosks (wall-screen / tablet layouts) ────────────────────

/** Body accepted by `POST /kiosks` — a new fixed-pixel layout canvas. */
export interface KioskCreateInput {
  name: string;
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Grid geometry + placed tiles. Defaults to an empty 12-col grid server-side. */
  config?: KioskConfig;
  /**
   * Front-end-only lock PIN (plain digits, not hashed — the browser compares it
   * locally). Omit or set to null/empty to leave the kiosk unlocked.
   */
  pin?: string | null;
}

export type KioskUpdateInput = Partial<KioskCreateInput>;

// ── roles & users (staff accounts, admin-managed — no self-registration) ──

/**
 * Body accepted by `POST /roles`. `deviceIds` is the full replacement set of
 * devices this role may see in the User UI (ignored for `isAdmin` roles,
 * which always see everything).
 */
export interface RoleCreateInput {
  name: string;
  isAdmin?: boolean;
  description?: string;
  deviceIds?: string[];
}

export type RoleUpdateInput = Partial<RoleCreateInput>;

/** Body accepted by `POST /users` — admin-created only, no self-registration. */
export interface UserCreateInput {
  username: string;
  password: string;
  roleId: string;
  displayName?: string;
  enabled?: boolean;
}

/** Same as `UserCreateInput`, but `password` is only sent when actually changing it. */
export type UserUpdateInput = Partial<Omit<UserCreateInput, "password">> & { password?: string };

/**
 * `GET /schedules/:id/next` preview — upcoming UTC fire times for a job. Times
 * are ISO UTC strings; display logic converts them to local time.
 */
export interface ScheduleNextRuns {
  id: string;
  cron: string;
  timezone: string;
  nextRuns: string[];
}

// ── API errors ───────────────────────────────────────────────

/** Error envelope every REST endpoint returns on failure (server + UI share it). */
export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

// ── log read model ───────────────────────────────────────────

/** Log severity levels (matches the `level` column). */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Count of log rows grouped by level (`GET /logs/stats`). */
export interface LevelCount {
  level: string;
  count: number;
}
