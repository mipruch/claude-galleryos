/**
 * Database repositories — typed data access via Drizzle.
 *
 * Provides CRUD for the core API resources (rooms, connections, devices) plus
 * the read-only `DeviceManagerRepo` adapter the DeviceManager consumes. More
 * repositories (scenes, schedules, logs) arrive with their feature steps.
 */

import { type SQL, and, arrayOverlaps, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  cameras,
  config,
  connections,
  devices,
  iframes,
  inputMappings,
  kiosks,
  logs,
  roleDevices,
  roles,
  rooms,
  sceneActions,
  sceneExecutions,
  scenes,
  scheduledJobs,
  triggerActions,
  users,
  workflowTargets,
} from "@gallery/types/schema";
import type {
  BulkRecordAction,
  Connection,
  Device,
  LevelCount,
  NewCamera,
  NewConnection,
  NewDevice,
  NewIframe,
  NewInputMapping,
  NewKiosk,
  NewRole,
  NewScheduledJob,
  NewTriggerAction,
  NewUser,
  NewWorkflowTarget,
  RoleWithDevices,
  SceneActionInput,
  SceneCreateInput,
  SceneUpdateInput,
  SceneWithActions,
} from "@gallery/types";
import { db } from "./client.ts";
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

// ── roles (n:n with devices via role_devices) ────────────────

async function withDeviceIds(role: typeof roles.$inferSelect): Promise<RoleWithDevices> {
  const rows = await db.select({ deviceId: roleDevices.deviceId }).from(roleDevices).where(eq(roleDevices.roleId, role.id));
  return { ...role, deviceIds: rows.map((r) => r.deviceId) };
}

export const rolesRepo = {
  async list(): Promise<RoleWithDevices[]> {
    const rows = await db.select().from(roles).orderBy(roles.name);
    return Promise.all(rows.map(withDeviceIds));
  },

  async get(id: string): Promise<RoleWithDevices | undefined> {
    const role = await first(db.select().from(roles).where(eq(roles.id, id)).limit(1));
    return role ? withDeviceIds(role) : undefined;
  },

  async create(values: NewRole, deviceIds: string[] = []): Promise<RoleWithDevices> {
    const role = await first(db.insert(roles).values(values).returning());
    if (!role) throw new Error("failed to create role");
    if (deviceIds.length) await this.setDevices(role.id, deviceIds);
    return this.get(role.id) as Promise<RoleWithDevices>;
  },

  async update(
    id: string,
    values: Partial<NewRole>,
    deviceIds?: string[],
  ): Promise<RoleWithDevices | undefined> {
    const updated = await first(
      db.update(roles).set({ ...values, updatedAt: new Date() }).where(eq(roles.id, id)).returning(),
    );
    if (!updated) return undefined;
    if (deviceIds !== undefined) await this.setDevices(id, deviceIds);
    return this.get(id);
  },

  remove: (id: string) => first(db.delete(roles).where(eq(roles.id, id)).returning()),

  /** How many users currently hold this role — blocks deletion when > 0. */
  async userCount(roleId: string): Promise<number> {
    const rows = await db.select({ n: count() }).from(users).where(eq(users.roleId, roleId));
    return rows[0]?.n ?? 0;
  },

  /** Replace the full set of devices a role may see (delete + insert). */
  async setDevices(roleId: string, deviceIds: string[]): Promise<void> {
    await db.delete(roleDevices).where(eq(roleDevices.roleId, roleId));
    if (deviceIds.length) {
      await db.insert(roleDevices).values(deviceIds.map((deviceId) => ({ roleId, deviceId })));
    }
  },
};

// ── users (staff accounts, admin-managed) ────────────────────

export const usersRepo = {
  list: () => db.select().from(users).orderBy(users.username),
  get: (id: string) => first(db.select().from(users).where(eq(users.id, id)).limit(1)),
  getByUsername: (username: string) =>
    first(db.select().from(users).where(eq(users.username, username)).limit(1)),
  create: (values: NewUser) => first(db.insert(users).values(values).returning()),
  update: (id: string, values: Partial<NewUser>) =>
    first(db.update(users).set({ ...values, updatedAt: new Date() }).where(eq(users.id, id)).returning()),
  remove: (id: string) => first(db.delete(users).where(eq(users.id, id)).returning()),
};

// ── config (runtime key/value settings) ──────────────────────

export const configRepo = {
  get: (key: string) => first(db.select().from(config).where(eq(config.key, key)).limit(1)),
  async set(key: string, value: unknown): Promise<void> {
    await db
      .insert(config)
      .values({ key, value })
      .onConflictDoUpdate({ target: config.key, set: { value, updatedAt: new Date() } });
  },
};

// ── iframes ──────────────────────────────────────────────────

export const iframesRepo = {
  list: () => db.select().from(iframes).orderBy(iframes.displayOrder),
  get: (id: string) => first(db.select().from(iframes).where(eq(iframes.id, id)).limit(1)),
  create: (values: NewIframe) => first(db.insert(iframes).values(values).returning()),
  update: (id: string, values: Partial<NewIframe>) =>
    first(
      db.update(iframes).set({ ...values, updatedAt: new Date() }).where(eq(iframes.id, id)).returning(),
    ),
  remove: (id: string) => first(db.delete(iframes).where(eq(iframes.id, id)).returning()),
};

// ── kiosks (wall-screen / tablet layouts) ────────────────────

export const kiosksRepo = {
    list: () => db.select().from(kiosks).orderBy(kiosks.name),
    get: (id: string) => first(db.select().from(kiosks).where(eq(kiosks.id, id)).limit(1)),
    /** Lookup by the unique name — the `/kiosk/:name` viewer key. */
    getByName: (name: string) => first(db.select().from(kiosks).where(eq(kiosks.name, name)).limit(1)),
    create: (values: NewKiosk) => first(db.insert(kiosks).values(values).returning()),
    update: (id: string, values: Partial<NewKiosk>) =>
        first(
            db.update(kiosks).set({ ...values, updatedAt: new Date() }).where(eq(kiosks.id, id)).returning(),
        ),
    remove: (id: string) => first(db.delete(kiosks).where(eq(kiosks.id, id)).returning()),
}
// ── cameras (RTSP CCTV sources) ──────────────────────────────

export const camerasRepo = {
  list: () => db.select().from(cameras).orderBy(cameras.displayOrder),
  /** Only enabled cameras — what the user UI sidebar shows. */
  listEnabled: () =>
    db.select().from(cameras).where(eq(cameras.enabled, true)).orderBy(cameras.displayOrder),
  get: (id: string) => first(db.select().from(cameras).where(eq(cameras.id, id)).limit(1)),
  create: (values: NewCamera) => first(db.insert(cameras).values(values).returning()),
  update: (id: string, values: Partial<NewCamera>) =>
    first(
      db.update(cameras).set({ ...values, updatedAt: new Date() }).where(eq(cameras.id, id)).returning(),
    ),
  remove: (id: string) => first(db.delete(cameras).where(eq(cameras.id, id)).returning()),
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

// ── bulk writes (spreadsheet editor) ─────────────────────────

/**
 * The connection half of one planned bulk row: `id` set updates that row,
 * absent inserts a new one. `values` is already validated by the route.
 */
export interface BulkConnectionWrite {
  id?: string;
  values: Partial<NewConnection>;
}

/**
 * The device half of one planned bulk row. `connectionId` is filled in by the
 * repo from the row's own connection when that connection is created in the
 * same batch (a 1:1 row: the id doesn't exist until the insert runs).
 */
export interface BulkDeviceWrite {
  id?: string;
  connectionId?: string;
  values: Partial<NewDevice>;
}

/** One planned connection row of a connection sheet (no device attached). */
export interface BulkConnectionWrite {
  id?: string;
  values: Partial<NewConnection>;
}

interface BulkConnectionOutcome {
  connectionId: string;
  action: BulkRecordAction;
}

/** One planned row: an optional connection to write, plus the device on it. */
export interface BulkWriteRow {
  connection?: BulkConnectionWrite;
  device: BulkDeviceWrite;
}

/** What one written row ended up as — ids resolved, actions recorded. */
interface BulkWriteOutcome {
  connectionId: string;
  deviceId: string;
  connectionAction: BulkRecordAction;
  deviceAction: BulkRecordAction;
}

interface BulkDeleteOutcome {
  deletedDevices: number;
  /** Connections deleted because the batch left them with no devices. */
  deletedConnections: string[];
  /** Connections that lost devices but still have some (need a cache refresh). */
  touchedConnections: string[];
}

/**
 * Bulk writes for the admin spreadsheet editor.
 *
 * Everything here runs inside one transaction on purpose: a 64-row import that
 * fails halfway would leave the operator reconciling half a rack by hand, so
 * either the whole sheet lands or none of it does. Validation (driver
 * manifests, referenced ids) happens in the route *before* these run — by this
 * point the only expected failures are database-level ones (a foreign key, a
 * lost connection), which roll the batch back.
 */
export const bulkRepo = {
  /** Insert/update every row atomically, resolving each row's connection first. */
  apply(rows: BulkWriteRow[]): Promise<BulkWriteOutcome[]> {
    return db.transaction(async (tx) => {
      const outcomes: BulkWriteOutcome[] = [];
      for (const row of rows) {
        let connectionId = row.device.connectionId;
        let connectionAction: BulkRecordAction = "unchanged";

        if (row.connection) {
          const { id, values } = row.connection;
          if (id) {
            const updated = await first(
              tx
                .update(connections)
                .set({ ...values, updatedAt: new Date() })
                .where(eq(connections.id, id))
                .returning(),
            );
            if (!updated) throw new Error(`connection ${id} disappeared mid-batch`);
            connectionId = updated.id;
            connectionAction = "updated";
          } else {
            // The route guarantees the required columns are present for an insert.
            const created = await first(tx.insert(connections).values(values as NewConnection).returning());
            if (!created) throw new Error("failed to create connection");
            connectionId = created.id;
            connectionAction = "created";
          }
        }

        const { id, values } = row.device;
        const written = id
          ? await first(
              tx
                .update(devices)
                .set({ ...values, ...(connectionId ? { connectionId } : {}), updatedAt: new Date() })
                .where(eq(devices.id, id))
                .returning(),
            )
          : connectionId
            ? await first(tx.insert(devices).values({ ...values, connectionId } as NewDevice).returning())
            : undefined;
        if (!written) {
          throw new Error(id ? `device ${id} disappeared mid-batch` : "device row has no connection");
        }

        outcomes.push({
          // On update the stored row is authoritative: a row that only patches
          // (say) a room never names a connection, so read it back off the device.
          connectionId: written.connectionId,
          deviceId: written.id,
          connectionAction,
          deviceAction: id ? "updated" : "created",
        });
      }
      return outcomes;
    });
  },

  /** Device ids among `deviceIds` that scenes still reference (delete would violate the FK). */
  async sceneReferenced(deviceIds: string[]): Promise<string[]> {
    if (!deviceIds.length) return [];
    const rows = await db
      .selectDistinct({ deviceId: sceneActions.deviceId })
      .from(sceneActions)
      .where(inArray(sceneActions.deviceId, deviceIds));
    return rows.map((r) => r.deviceId).filter((id): id is string => id !== null);
  },

  /**
   * Delete devices atomically, optionally taking connections the batch empties
   * with them (the counterpart of 1:1 rows — deleting the display should not
   * strand its connection).
   */
  deleteDevices(deviceIds: string[], deleteOrphanedConnections: boolean): Promise<BulkDeleteOutcome> {
    return db.transaction(async (tx) => {
      if (!deviceIds.length) {
        return { deletedDevices: 0, deletedConnections: [], touchedConnections: [] };
      }
      const removed = await tx.delete(devices).where(inArray(devices.id, deviceIds)).returning();
      const affected = [...new Set(removed.map((d) => d.connectionId))];
      const deletedConnections: string[] = [];
      const touchedConnections: string[] = [];
      for (const connectionId of affected) {
        const remaining = await tx
          .select({ n: count() })
          .from(devices)
          .where(eq(devices.connectionId, connectionId));
        if (deleteOrphanedConnections && (remaining[0]?.n ?? 0) === 0) {
          await tx.delete(connections).where(eq(connections.id, connectionId));
          deletedConnections.push(connectionId);
        } else {
          touchedConnections.push(connectionId);
        }
      }
      return { deletedDevices: removed.length, deletedConnections, touchedConnections };
    });
  },

  /**
   * Insert/update connections atomically — the connection sheet's write.
   * Same all-or-nothing reasoning as `apply`: twenty NETIOs land together or
   * not at all.
   */
  applyConnections(rows: BulkConnectionWrite[]): Promise<BulkConnectionOutcome[]> {
    return db.transaction(async (tx) => {
      const outcomes: BulkConnectionOutcome[] = [];
      for (const { id, values } of rows) {
        const written = id
          ? await first(
              tx
                .update(connections)
                .set({ ...values, updatedAt: new Date() })
                .where(eq(connections.id, id))
                .returning(),
            )
          : // The route guarantees the required columns are present for an insert.
            await first(tx.insert(connections).values(values as NewConnection).returning());
        if (!written) throw new Error(id ? `connection ${id} disappeared mid-batch` : "failed to create connection");
        outcomes.push({ connectionId: written.id, action: id ? "updated" : "created" });
      }
      return outcomes;
    });
  },

  /** Connection ids among `connectionIds` that still carry devices (delete would violate the FK). */
  async connectionsWithDevices(connectionIds: string[]): Promise<string[]> {
    if (!connectionIds.length) return [];
    const rows = await db
      .selectDistinct({ connectionId: devices.connectionId })
      .from(devices)
      .where(inArray(devices.connectionId, connectionIds));
    return rows.map((r) => r.connectionId);
  },

  /** Delete connections atomically. Callers check `connectionsWithDevices` first. */
  async deleteConnections(connectionIds: string[]): Promise<number> {
    if (!connectionIds.length) return 0;
    const removed = await db.delete(connections).where(inArray(connections.id, connectionIds)).returning();
    return removed.length;
  },
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

export interface SceneFilter {
  roomId?: string;
  isFavorite?: boolean;
  /** Match scenes carrying ANY of these tags. */
  tags?: string[];
}

/**
 * Map an action input to a row insert for a given scene, defaulting stepOrder.
 * A sub-scene action (`childSceneId`) carries no device/command; a device action
 * carries no `childSceneId`. The DB CHECK constraint guards the invariant.
 */
function toActionRow(sceneId: string, a: SceneActionInput, index: number): typeof sceneActions.$inferInsert {
  const isSubScene = !!a.childSceneId;
  return {
    sceneId,
    deviceId: isSubScene ? null : a.deviceId,
    childSceneId: a.childSceneId ?? null,
    command: isSubScene ? null : a.command,
    params: a.params ?? {},
    stepOrder: a.stepOrder ?? index,
    parallelGroup: a.parallelGroup ?? 0,
    delayMs: a.delayMs ?? 0,
    onFailure: a.onFailure ?? "continue",
    position: a.position ?? null,
  };
}

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

// ── scheduled jobs (CRON) ────────────────────────────────────

export const scheduledJobsRepo = {
  /** All jobs, newest first. */
  list: () => db.select().from(scheduledJobs).orderBy(desc(scheduledJobs.createdAt)),

  /** Only enabled jobs — what the Scheduler arms on startup. */
  listEnabled: () =>
    db.select().from(scheduledJobs).where(eq(scheduledJobs.enabled, true)),

  get: (id: string) =>
    first(db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).limit(1)),

  create: (values: NewScheduledJob) =>
    first(db.insert(scheduledJobs).values(values).returning()),

  update: (id: string, values: Partial<NewScheduledJob>) =>
    first(
      db
        .update(scheduledJobs)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(scheduledJobs.id, id))
        .returning(),
    ),

  remove: (id: string) =>
    first(db.delete(scheduledJobs).where(eq(scheduledJobs.id, id)).returning()),

  /** Toggle enabled without touching the rest of the row. */
  setEnabled: (id: string, enabled: boolean) =>
    first(
      db
        .update(scheduledJobs)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(scheduledJobs.id, id))
        .returning(),
    ),

  // ── Scheduler write-backs (do NOT bump updatedAt — these are runtime
  //    bookkeeping, not user edits) ──
  setNextRunAt: (id: string, nextRunAt: Date | null) =>
    db.update(scheduledJobs).set({ nextRunAt }).where(eq(scheduledJobs.id, id)),

  setLastRunAt: (id: string, lastRunAt: Date) =>
    db.update(scheduledJobs).set({ lastRunAt }).where(eq(scheduledJobs.id, id)),
};

// ── input mappings (OSC/TCP/HTTP ingress → action) ───────────

export interface InputMappingFilter {
  protocol?: string;
  enabled?: boolean;
}

export const inputMappingsRepo = {
  /** All mappings, newest first; optionally filtered by protocol/enabled. */
  list: (filter: InputMappingFilter = {}) => {
    const conds: SQL[] = [];
    if (filter.protocol !== undefined) conds.push(eq(inputMappings.protocol, filter.protocol as never));
    if (filter.enabled !== undefined) conds.push(eq(inputMappings.enabled, filter.enabled));
    const q = db.select().from(inputMappings).orderBy(desc(inputMappings.createdAt));
    return conds.length ? q.where(and(...conds)) : q;
  },

  /** Only enabled mappings — what the InputMapper caches. */
  listEnabled: () =>
    db.select().from(inputMappings).where(eq(inputMappings.enabled, true)),

  get: (id: string) =>
    first(db.select().from(inputMappings).where(eq(inputMappings.id, id)).limit(1)),

  create: (values: NewInputMapping) =>
    first(db.insert(inputMappings).values(values).returning()),

  update: (id: string, values: Partial<NewInputMapping>) =>
    first(
      db
        .update(inputMappings)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(inputMappings.id, id))
        .returning(),
    ),

  remove: (id: string) =>
    first(db.delete(inputMappings).where(eq(inputMappings.id, id)).returning()),

  /** Toggle enabled without touching the rest of the row. */
  setEnabled: (id: string, enabled: boolean) =>
    first(
      db
        .update(inputMappings)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(inputMappings.id, id))
        .returning(),
    ),
};

// ── workflow targets (a scene/device instance placed on the canvas) ──

export const workflowTargetsRepo = {
  /** Every placed instance. */
  list: () => db.select().from(workflowTargets).orderBy(desc(workflowTargets.createdAt)),

  get: (id: string) =>
    first(db.select().from(workflowTargets).where(eq(workflowTargets.id, id)).limit(1)),

  create: (values: NewWorkflowTarget) =>
    first(db.insert(workflowTargets).values(values).returning()),

  update: (id: string, values: Partial<NewWorkflowTarget>) =>
    first(
      db
        .update(workflowTargets)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(workflowTargets.id, id))
        .returning(),
    ),

  remove: (id: string) =>
    first(db.delete(workflowTargets).where(eq(workflowTargets.id, id)).returning()),
};

// ── trigger actions (which trigger fires which workflow target) ──

/** The joined shape {@link TriggerActionDispatcher} needs — trigger_actions' own id, plus its target's dispatchable fields. */
const dispatchableColumns = {
  id: triggerActions.id,
  targetType: workflowTargets.targetType,
  targetId: workflowTargets.targetId,
  targetCommand: workflowTargets.targetCommand,
  params: workflowTargets.params,
};

export const triggerActionsRepo = {
  /** All wires, newest first. */
  list: () => db.select().from(triggerActions).orderBy(desc(triggerActions.createdAt)),

  /** Wires from one schedule (admin/list use — not dispatch, see listDispatchableByScheduleId). */
  listByScheduleId: (scheduleId: string) =>
    db.select().from(triggerActions).where(eq(triggerActions.scheduleId, scheduleId)),

  /** Wires from one mapping (admin/list use — not dispatch). */
  listByMappingId: (mappingId: string) =>
    db.select().from(triggerActions).where(eq(triggerActions.mappingId, mappingId)),

  /** Wires from one schedule, joined with their target's dispatchable fields — what the Scheduler fires on fire. */
  listDispatchableByScheduleId: (scheduleId: string) =>
    db
      .select(dispatchableColumns)
      .from(triggerActions)
      .innerJoin(workflowTargets, eq(triggerActions.workflowTargetId, workflowTargets.id))
      .where(eq(triggerActions.scheduleId, scheduleId)),

  /** Wires from any of several mappings, joined with their targets — what the InputMapper cache holds. */
  listDispatchableByMappingIds: (mappingIds: string[]) =>
    mappingIds.length
      ? db
          .select({ ...dispatchableColumns, mappingId: triggerActions.mappingId })
          .from(triggerActions)
          .innerJoin(workflowTargets, eq(triggerActions.workflowTargetId, workflowTargets.id))
          .where(inArray(triggerActions.mappingId, mappingIds))
      : Promise.resolve([]),

  get: (id: string) =>
    first(db.select().from(triggerActions).where(eq(triggerActions.id, id)).limit(1)),

  create: (values: NewTriggerAction) =>
    first(db.insert(triggerActions).values(values).returning()),

  remove: (id: string) =>
    first(db.delete(triggerActions).where(eq(triggerActions.id, id)).returning()),
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
