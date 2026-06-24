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
import type { OnFailure } from "./enums.ts";
import type { KioskConfig } from "./kiosk.ts";
import {
  connections,
  devices,
  iframes,
  kiosks,
  logs,
  rooms,
  sceneActions,
  sceneExecutions,
  scenes,
  scheduledJobs,
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
export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;

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
export type ScheduledJobDTO = Jsonify<ScheduledJob>;

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
}

export type KioskUpdateInput = Partial<KioskCreateInput>;

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
