/**
 * Database repositories — typed data access via Drizzle.
 *
 * Provides CRUD for the core API resources (rooms, connections, devices) plus
 * the read-only `DeviceManagerRepo` adapter the DeviceManager consumes. More
 * repositories (scenes, schedules, logs) arrive with their feature steps.
 */

import { type SQL, and, count, eq } from "drizzle-orm";
import { db } from "./client.ts";
import {
  type Connection,
  type Device,
  type NewConnection,
  type NewDevice,
  connections,
  devices,
  rooms,
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
