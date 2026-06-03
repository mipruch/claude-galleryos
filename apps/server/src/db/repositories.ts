/**
 * Database repositories — typed data access via Drizzle.
 *
 * Provides CRUD for the core API resources (rooms, connections, devices) plus
 * the read-only `DeviceManagerRepo` adapter the DeviceManager consumes. More
 * repositories (scenes, schedules, logs) arrive with their feature steps.
 */

import { type SQL, and, arrayOverlaps, count, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "./client.ts";
import {
  type Connection,
  type Device,
  type NewConnection,
  type NewDevice,
  connections,
  devices,
  logs,
  rooms,
  sceneActions,
  sceneExecutions,
  scenes,
} from "./schema.ts";
import type {
  ConnectionRecord,
  DeviceManagerRepo,
  DeviceRecord,
} from "../core/DeviceManager.ts";

const first = async <T>(rows: Promise<T[]>): Promise<T | undefined> => (await rows)[0];

// ── mappers (DB rows → DeviceManager records) ────────────────

export function toConnectionRecord(row: Connection): ConnectionRecord {
  return { id: row.id, driverId: row.driverId, host: row.host, port: row.port, config: row.config };
}

export function toDeviceRecord(row: Device): DeviceRecord {
  return {
    id: row.id,
    connectionId: row.connectionId,
    name: row.name,
    endpointType: row.subtype ?? row.type, // driver endpoint type lives in `subtype`
    address: row.address,
  };
}

// ── rooms ────────────────────────────────────────────────────

export const roomsRepo = {
  list: () => db.select().from(rooms).orderBy(rooms.displayOrder),
  get: (id: string) => first(db.select().from(rooms).where(eq(rooms.id, id)).limit(1)),
  create: (values: typeof rooms.$inferInsert) =>
    first(db.insert(rooms).values(values).returning()),
  update: (id: string, values: Partial<typeof rooms.$inferInsert>) =>
    first(db.update(rooms).set({ ...values, updatedAt: new Date() }).where(eq(rooms.id, id)).returning()),
  remove: (id: string) => first(db.delete(rooms).where(eq(rooms.id, id)).returning()),
};

// ── connections ──────────────────────────────────────────────

export const connectionsRepo = {
  list: () => db.select().from(connections).orderBy(connections.createdAt),
  get: (id: string) => first(db.select().from(connections).where(eq(connections.id, id)).limit(1)),
  create: (values: NewConnection) => first(db.insert(connections).values(values).returning()),
  update: (id: string, values: Partial<NewConnection>) =>
    first(
      db.update(connections).set({ ...values, updatedAt: new Date() }).where(eq(connections.id, id)).returning(),
    ),
  remove: (id: string) => first(db.delete(connections).where(eq(connections.id, id)).returning()),
  async deviceCount(id: string): Promise<number> {
    const rows = await db.select({ n: count() }).from(devices).where(eq(devices.connectionId, id));
    return rows[0]?.n ?? 0;
  },
};

// ── devices ──────────────────────────────────────────────────

export interface DeviceFilter {
  roomId?: string;
  type?: string;
  enabled?: boolean;
  connectionId?: string;
}

export const devicesRepo = {
  list(filter: DeviceFilter = {}) {
    const where: SQL[] = [];
    if (filter.roomId) where.push(eq(devices.roomId, filter.roomId));
    if (filter.type) where.push(eq(devices.type, filter.type));
    if (filter.enabled !== undefined) where.push(eq(devices.enabled, filter.enabled));
    if (filter.connectionId) where.push(eq(devices.connectionId, filter.connectionId));
    return where.length
      ? db.select().from(devices).where(and(...where))
      : db.select().from(devices);
  },
  get: (id: string) => first(db.select().from(devices).where(eq(devices.id, id)).limit(1)),
  create: (values: NewDevice) => first(db.insert(devices).values(values).returning()),
  update: (id: string, values: Partial<NewDevice>) =>
    first(db.update(devices).set({ ...values, updatedAt: new Date() }).where(eq(devices.id, id)).returning()),
  remove: (id: string) => first(db.delete(devices).where(eq(devices.id, id)).returning()),
};

// ── logs (read-only; written by DbLogTransport) ──────────────

export interface LogFilter {
  level?: string;
  source?: string;
  entityId?: string;
  /** Inclusive lower bound on `ts`. */
  from?: Date;
  /** Inclusive upper bound on `ts`. */
  to?: Date;
  limit?: number;
  offset?: number;
}

/** Counts grouped by level since a point in time. */
export interface LevelCount {
  level: string;
  count: number;
}

export const logsRepo = {
  /** Newest-first list with optional filters and pagination. */
  list(filter: LogFilter = {}) {
    const where: SQL[] = [];
    if (filter.level) where.push(eq(logs.level, filter.level));
    if (filter.source) where.push(eq(logs.source, filter.source));
    if (filter.entityId) where.push(eq(logs.entityId, filter.entityId));
    if (filter.from) where.push(gte(logs.ts, filter.from));
    if (filter.to) where.push(lte(logs.ts, filter.to));

    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
    const offset = Math.max(filter.offset ?? 0, 0);

    const base = db.select().from(logs);
    const filtered = where.length ? base.where(and(...where)) : base;
    return filtered.orderBy(desc(logs.ts)).limit(limit).offset(offset);
  },

  /** Count of rows grouped by level since `since`. */
  async statsByLevel(since: Date): Promise<LevelCount[]> {
    const rows = await db
      .select({ level: logs.level, count: count() })
      .from(logs)
      .where(gte(logs.ts, since))
      .groupBy(logs.level);
    return rows.map((r) => ({ level: r.level, count: Number(r.count) }));
  },
};

// ── scenes ───────────────────────────────────────────────────

/** One action of a scene, as accepted by create/update. */
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

export interface SceneFilter {
  roomId?: string;
  isFavorite?: boolean;
  /** Match scenes carrying ANY of these tags. */
  tags?: string[];
}

/** Map an action input to a row insert for a given scene, defaulting stepOrder. */
function toActionRow(sceneId: string, a: SceneActionInput, index: number): typeof sceneActions.$inferInsert {
  return {
    sceneId,
    deviceId: a.deviceId,
    command: a.command,
    params: a.params ?? {},
    stepOrder: a.stepOrder ?? index,
    parallelGroup: a.parallelGroup ?? 0,
    delayMs: a.delayMs ?? 0,
    onFailure: a.onFailure ?? "continue",
  };
}

/** A scene plus its ordered actions (the shape `get` returns). */
export type SceneWithActions = typeof scenes.$inferSelect & {
  actions: (typeof sceneActions.$inferSelect)[];
};

export const sceneActionsRepo = {
  /** Replace every action of a scene (delete + insert). */
  async replaceAll(sceneId: string, actions: SceneActionInput[]): Promise<void> {
    await db.delete(sceneActions).where(eq(sceneActions.sceneId, sceneId));
    if (actions.length) {
      await db.insert(sceneActions).values(actions.map((a, i) => toActionRow(sceneId, a, i)));
    }
  },
};

export const scenesRepo = {
  list(filter: SceneFilter = {}) {
    const where: SQL[] = [];
    if (filter.roomId) where.push(eq(scenes.roomId, filter.roomId));
    if (filter.isFavorite !== undefined) where.push(eq(scenes.isFavorite, filter.isFavorite));
    if (filter.tags?.length) where.push(arrayOverlaps(scenes.tags, filter.tags));
    return where.length
      ? db.select().from(scenes).where(and(...where)).orderBy(scenes.name)
      : db.select().from(scenes).orderBy(scenes.name);
  },

  /** Scene + actions ordered by stepOrder, or undefined if not found. */
  async get(id: string): Promise<SceneWithActions | undefined> {
    const scene = await first(db.select().from(scenes).where(eq(scenes.id, id)).limit(1));
    if (!scene) return undefined;
    const actions = await db
      .select()
      .from(sceneActions)
      .where(eq(sceneActions.sceneId, id))
      .orderBy(sceneActions.stepOrder);
    return { ...scene, actions };
  },

  /** Create a scene with its initial actions; returns the full scene. */
  async create(input: SceneCreateInput): Promise<SceneWithActions> {
    const scene = await first(
      db
        .insert(scenes)
        .values({
          name: input.name,
          roomId: input.roomId ?? null,
          description: input.description,
          icon: input.icon,
          color: input.color,
          tags: input.tags ?? [],
          isFavorite: input.isFavorite ?? false,
        })
        .returning(),
    );
    if (!scene) throw new Error("failed to create scene");
    if (input.actions?.length) await sceneActionsRepo.replaceAll(scene.id, input.actions);
    return (await this.get(scene.id))!;
  },

  /** Update scene metadata and (if provided) replace its actions. */
  async update(id: string, input: SceneUpdateInput): Promise<SceneWithActions | undefined> {
    const patch: Partial<typeof scenes.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.roomId !== undefined) patch.roomId = input.roomId;
    if (input.description !== undefined) patch.description = input.description;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.color !== undefined) patch.color = input.color;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.isFavorite !== undefined) patch.isFavorite = input.isFavorite;

    const updated = await first(db.update(scenes).set(patch).where(eq(scenes.id, id)).returning());
    if (!updated) return undefined;
    if (input.actions !== undefined) await sceneActionsRepo.replaceAll(id, input.actions);
    return this.get(id);
  },

  /** Toggle/set the favorite flag only. */
  setFavorite: (id: string, isFavorite: boolean) =>
    first(
      db.update(scenes).set({ isFavorite, updatedAt: new Date() }).where(eq(scenes.id, id)).returning(),
    ),

  remove: (id: string) => first(db.delete(scenes).where(eq(scenes.id, id)).returning()),
};

// ── scene executions ─────────────────────────────────────────

export const sceneExecutionsRepo = {
  /** Newest-first execution history, with the scene name joined in. */
  list(opts: { sceneId?: string; status?: string; limit?: number } = {}) {
    const where: SQL[] = [];
    if (opts.sceneId) where.push(eq(sceneExecutions.sceneId, opts.sceneId));
    if (opts.status) where.push(eq(sceneExecutions.status, opts.status));

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);

    const base = db
      .select({
        id: sceneExecutions.id,
        sceneId: sceneExecutions.sceneId,
        sceneName: scenes.name,
        status: sceneExecutions.status,
        source: sceneExecutions.source,
        sourceDetail: sceneExecutions.sourceDetail,
        errorMessage: sceneExecutions.errorMessage,
        startedAt: sceneExecutions.startedAt,
        completedAt: sceneExecutions.completedAt,
        durationMs: sceneExecutions.durationMs,
      })
      .from(sceneExecutions)
      .leftJoin(scenes, eq(sceneExecutions.sceneId, scenes.id));

    const filtered = where.length ? base.where(and(...where)) : base;
    return filtered.orderBy(desc(sceneExecutions.startedAt)).limit(limit);
  },

  /** Convenience: executions for one scene, newest first. */
  listByScene: (sceneId: string) => sceneExecutionsRepo.list({ sceneId }),

  /** Insert a new execution row (defaults status to "running"). */
  create: (data: {
    /** Optional explicit id (e.g. a WS-generated executionId); otherwise random. */
    id?: string;
    sceneId: string;
    source: string;
    sourceDetail?: string;
    status?: string;
  }) =>
    first(
      db
        .insert(sceneExecutions)
        .values({
          ...(data.id ? { id: data.id } : {}),
          sceneId: data.sceneId,
          source: data.source,
          sourceDetail: data.sourceDetail,
          status: data.status ?? "running",
        })
        .returning(),
    ),

  /** Mark an execution finished (status + completedAt + optional duration/error). */
  updateStatus: (id: string, status: string, durationMs?: number, errorMessage?: string) =>
    first(
      db
        .update(sceneExecutions)
        .set({ status, durationMs, errorMessage, completedAt: new Date() })
        .where(eq(sceneExecutions.id, id))
        .returning(),
    ),

  /** The currently-running execution for a scene, if any. */
  getRunning: (sceneId: string) =>
    first(
      db
        .select()
        .from(sceneExecutions)
        .where(and(eq(sceneExecutions.sceneId, sceneId), eq(sceneExecutions.status, "running")))
        .limit(1),
    ),
};

// ── DeviceManager adapter (read-only) ────────────────────────

export const dbRepo: DeviceManagerRepo = {
  async listEnabledConnections() {
    const rows = await db.select().from(connections).where(eq(connections.enabled, true));
    return rows.map(toConnectionRecord);
  },
  async listDevicesByConnection(connectionId) {
    const rows = await db
      .select()
      .from(devices)
      .where(and(eq(devices.connectionId, connectionId), eq(devices.enabled, true)));
    return rows.map(toDeviceRecord);
  },
  async getDevice(deviceId) {
    const rows = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    return rows[0] ? toDeviceRecord(rows[0]) : undefined;
  },
};
