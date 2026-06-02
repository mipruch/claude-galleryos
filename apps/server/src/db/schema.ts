/**
 * Database schema (Drizzle ORM, PostgreSQL / TimescaleDB).
 *
 * This is the full GalleryOS schema (README §5). Drizzle generates types and SQL
 * migrations from these definitions. TimescaleDB-specific setup for the `logs`
 * table (hypertable, compression, retention) is applied separately in
 * `migrate.ts` because it isn't expressible in plain Drizzle DDL.
 *
 * Conventions: snake_case columns, UUID primary keys, timestamptz everywhere.
 */

import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ─────────────────────────────────────────────────────────────
// rooms — zones used to organise devices and scenes
// ─────────────────────────────────────────────────────────────
export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }),
  color: varchar("color", { length: 7 }),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─────────────────────────────────────────────────────────────
// connections — one physical socket / gateway (drives a DriverHost)
// ─────────────────────────────────────────────────────────────
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    driverId: varchar("driver_id", { length: 100 }).notNull(),
    host: varchar("host", { length: 255 }),
    port: integer("port"),
    protocol: varchar("protocol", { length: 20 }).default("tcp"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: varchar("created_by", { length: 100 }).default("admin"),
  },
  (t) => [index("idx_connections_driver").on(t.driverId)],
);

// ─────────────────────────────────────────────────────────────
// devices — logical addressable endpoints under a connection
// ─────────────────────────────────────────────────────────────
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "restrict" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    type: varchar("type", { length: 50 }).notNull(),
    subtype: varchar("subtype", { length: 100 }),
    address: jsonb("address").$type<Record<string, unknown>>().notNull(),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    icon: varchar("icon", { length: 50 }),
    displayOrder: integer("display_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: varchar("created_by", { length: 100 }).default("admin"),
  },
  (t) => [
    index("idx_devices_room").on(t.roomId),
    index("idx_devices_connection").on(t.connectionId),
    index("idx_devices_type").on(t.type),
  ],
);

// ─────────────────────────────────────────────────────────────
// scenes — named sets of actions
// ─────────────────────────────────────────────────────────────
export const scenes = pgTable(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    icon: varchar("icon", { length: 50 }),
    color: varchar("color", { length: 7 }),
    isFavorite: boolean("is_favorite").notNull().default(false),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    variables: jsonb("variables").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: varchar("created_by", { length: 100 }).default("admin"),
  },
  (t) => [index("idx_scenes_room").on(t.roomId), index("idx_scenes_favorite").on(t.isFavorite)],
);

// ─────────────────────────────────────────────────────────────
// scene_versions — archived snapshots on each edit
// ─────────────────────────────────────────────────────────────
export const sceneVersions = pgTable(
  "scene_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    createdBy: varchar("created_by", { length: 100 }).default("admin"),
  },
  (t) => [index("idx_scene_versions_scene").on(t.sceneId)],
);

// ─────────────────────────────────────────────────────────────
// scene_actions — the steps of a scene
// ─────────────────────────────────────────────────────────────
export const sceneActions = pgTable(
  "scene_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "restrict" }),
    stepOrder: integer("step_order").notNull().default(0),
    parallelGroup: integer("parallel_group").notNull().default(0),
    delayMs: integer("delay_ms").notNull().default(0),
    command: varchar("command", { length: 100 }).notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    onFailure: varchar("on_failure", { length: 20 }).notNull().default("continue"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_scene_actions_scene").on(t.sceneId, t.stepOrder)],
);

// ─────────────────────────────────────────────────────────────
// scene_executions — run tracking (recovery after restart)
// ─────────────────────────────────────────────────────────────
export const sceneExecutions = pgTable(
  "scene_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("running"),
    source: varchar("source", { length: 100 }).notNull(),
    sourceDetail: varchar("source_detail", { length: 255 }),
    preState: jsonb("pre_state").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("idx_scene_executions_scene").on(t.sceneId),
    index("idx_scene_executions_status").on(t.status),
    index("idx_scene_executions_started").on(t.startedAt.desc()),
  ],
);

// ─────────────────────────────────────────────────────────────
// scheduled_jobs — CRON schedules
// ─────────────────────────────────────────────────────────────
export const scheduledJobs = pgTable("scheduled_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  sceneId: uuid("scene_id")
    .notNull()
    .references(() => scenes.id, { onDelete: "cascade" }),
  cron: varchar("cron", { length: 100 }).notNull(),
  timezone: varchar("timezone", { length: 50 }).notNull().default("Europe/Prague"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: varchar("created_by", { length: 100 }).default("admin"),
});

// ─────────────────────────────────────────────────────────────
// input_mappings — OSC/TCP/HTTP signal → action
// ─────────────────────────────────────────────────────────────
export const inputMappings = pgTable(
  "input_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    protocol: varchar("protocol", { length: 20 }).notNull(),
    pattern: varchar("pattern", { length: 255 }).notNull(),
    targetType: varchar("target_type", { length: 50 }).notNull(),
    targetId: uuid("target_id"),
    targetCommand: varchar("target_command", { length: 100 }),
    paramsTemplate: jsonb("params_template").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_input_mappings_protocol").on(t.protocol, t.enabled)],
);

// ─────────────────────────────────────────────────────────────
// ui_layouts — User UI layout configuration
// ─────────────────────────────────────────────────────────────
export const uiLayouts = pgTable("ui_layouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─────────────────────────────────────────────────────────────
// config — runtime key/value settings
// ─────────────────────────────────────────────────────────────
export const config = pgTable("config", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

// ─────────────────────────────────────────────────────────────
// logs — structured audit log (converted to a TimescaleDB hypertable
// in migrate.ts). No primary key: hypertables partition on `ts`.
// ─────────────────────────────────────────────────────────────
export const logs = pgTable(
  "logs",
  {
    id: bigserial("id", { mode: "number" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    level: varchar("level", { length: 10 }).notNull(),
    source: varchar("source", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }),
    entityId: uuid("entity_id"),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("idx_logs_entity").on(t.entityType, t.entityId, t.ts.desc()),
    index("idx_logs_source").on(t.source, t.ts.desc()),
  ],
);

// Convenient inferred types for the rest of the codebase.
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type Room = typeof rooms.$inferSelect;
export type Scene = typeof scenes.$inferSelect;
export type LogRow = typeof logs.$inferInsert;
