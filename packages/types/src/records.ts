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
import {
  connections,
  devices,
  iframes,
  logs,
  rooms,
  sceneActions,
  sceneExecutions,
  scenes,
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

/**
 * A connection as `GET /connections` returns it: the serialized row plus the
 * live `running` flag attached from the DriverHost pool (not a DB column).
 */
export type ConnectionWithRuntime = ConnectionDTO & { running: boolean };

// ── request bodies (API inputs; shared so FE forms stay in sync) ──

/** One action of a scene, as accepted by scene create/update. */
export interface SceneActionInput {
  deviceId: string;
  command: string;
  params?: Record<string, unknown>;
  /** Defaults to the action's position in the array if omitted. */
  stepOrder?: number;
  /** Actions in the same group run concurrently; groups run in ascending order. */
  parallelGroup?: number;
  /** Delay (ms) applied before this action runs. */
  delayMs?: number;
  /** "continue" (default) or "abort". */
  onFailure?: string;
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

// ── log read model ───────────────────────────────────────────

/** Log severity levels (matches the `level` column). */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Count of log rows grouped by level (`GET /logs/stats`). */
export interface LevelCount {
  level: string;
  count: number;
}
