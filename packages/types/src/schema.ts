/**
 * Database schema (Drizzle ORM, PostgreSQL / TimescaleDB) — the single source of
 * truth for every persisted record in GalleryOS (README §5).
 *
 * This package owns the schema so that both the server (queries, migrations) and
 * the UI (derived row/DTO types) reference one definition. Drizzle generates SQL
 * migrations from these tables; TimescaleDB-specific setup for the `logs` table
 * (hypertable, compression, retention) is applied separately in the server's
 * `migrate.ts` because it isn't expressible in plain Drizzle DDL.
 *
 * Inferred row types (`Connection`, `Device`, …) live in `./records.ts`.
 *
 * Conventions: snake_case columns, UUID primary keys, timestamptz everywhere.
 */

import { sql } from "drizzle-orm";
import type { CanvasPosition } from "./canvas.ts";
import type { InputProtocol, OnFailure, TriggerTargetType } from "./enums.ts";
import type { KioskConfig } from "./kiosk.ts";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
// roles — named permission sets. `isAdmin` roles see and do
// everything; every other role's visible devices are listed in
// `role_devices` below (an empty set means that role sees nothing).
// ─────────────────────────────────────────────────────────────
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 50 }).notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("idx_roles_name").on(t.name)],
);

// ─────────────────────────────────────────────────────────────
// users — staff accounts. Admin-created only, no self-registration.
// ─────────────────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 100 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 100 }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("idx_users_username").on(t.username)],
);

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
    /** Node position on the workflow routing-map canvas; NULL = not yet placed there. */
    position: jsonb("position").$type<CanvasPosition | null>(),
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
// role_devices — which devices each non-admin role may see in the
// User UI (n:n). Admin roles bypass this entirely (roles.isAdmin).
// ─────────────────────────────────────────────────────────────
export const roleDevices = pgTable(
  "role_devices",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.deviceId] }), index("idx_role_devices_device").on(t.deviceId)],
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
    /** Node position on the workflow routing-map canvas; NULL = not yet placed there. */
    position: jsonb("position").$type<CanvasPosition | null>(),
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
// An action is either a *device* action (deviceId + command) or a *sub-scene*
// action (childSceneId): running another scene as a step. Composing scenes from
// scenes lets a parent like "Turn everything off" reuse "Turn off Hall A" etc.,
// so editing the child propagates to every parent that references it. The CHECK
// constraint enforces exactly one target shape; cycles are rejected at run time
// by the SceneEngine's pre-flight.
export const sceneActions = pgTable(
  "scene_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    // Set for device actions; null for sub-scene actions.
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "restrict" }),
    // Set for sub-scene actions; null for device actions. `restrict` stops a
    // scene from being deleted while another scene still references it.
    childSceneId: uuid("child_scene_id").references(() => scenes.id, { onDelete: "restrict" }),
    stepOrder: integer("step_order").notNull().default(0),
    parallelGroup: integer("parallel_group").notNull().default(0),
    delayMs: integer("delay_ms").notNull().default(0),
    // Required for device actions; null for sub-scene actions.
    command: varchar("command", { length: 100 }),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    onFailure: varchar("on_failure", { length: 20 }).$type<OnFailure>().notNull().default("continue"),
    // Where this action's node was last dropped on the scene's workflow canvas
    // (packages/types/src/canvas.ts). Purely a layout hint — null until the
    // scene is opened on the canvas, at which point it gets an auto-layout
    // position; never read by the SceneEngine.
    position: jsonb("position").$type<CanvasPosition | null>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_scene_actions_scene").on(t.sceneId, t.stepOrder),
    index("idx_scene_actions_child").on(t.childSceneId),
    check(
      "scene_actions_target_chk",
      sql`(${t.deviceId} IS NOT NULL AND ${t.childSceneId} IS NULL AND ${t.command} IS NOT NULL)
        OR (${t.childSceneId} IS NOT NULL AND ${t.deviceId} IS NULL)`,
    ),
  ],
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
// scheduled_jobs — CRON schedules. Purely "when": what runs lives in
// trigger_actions below, so a schedule can exist unwired (no rows yet)
// and later fan out to several actions — it no longer embeds a target.
// ─────────────────────────────────────────────────────────────
export const scheduledJobs = pgTable("scheduled_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  cron: varchar("cron", { length: 100 }).notNull(),
  timezone: varchar("timezone", { length: 50 }).notNull().default("Europe/Prague"),
  enabled: boolean("enabled").notNull().default(true),
  // Node position on the workflow routing-map canvas (see scene_actions.position).
  position: jsonb("position").$type<CanvasPosition | null>(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: varchar("created_by", { length: 100 }).default("admin"),
});

// ─────────────────────────────────────────────────────────────
// input_mappings — OSC/TCP/HTTP signal → match. Purely "when" too, same
// reasoning as scheduled_jobs: what runs lives in trigger_actions.
// ─────────────────────────────────────────────────────────────
export const inputMappings = pgTable(
  "input_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    protocol: varchar("protocol", { length: 20 }).$type<InputProtocol>().notNull(),
    pattern: varchar("pattern", { length: 255 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // Node position on the workflow routing-map canvas (see scene_actions.position).
    position: jsonb("position").$type<CanvasPosition | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_input_mappings_protocol").on(t.protocol, t.enabled)],
);

// ─────────────────────────────────────────────────────────────
// trigger_actions — what a schedule or mapping fires: one row per action,
// so a single trigger can fan out to several (mirrors scene_actions, which
// is the same "one row per step, many rows per owner" shape for scenes).
//
// `scheduleId` XOR `mappingId` names the owning trigger. `targetId`/
// `targetCommand` carry no hard FK (they mean a scene or a device depending
// on `targetType`, checked in the route layer, same as scene_actions'
// device_id) and may be null: a freshly-added action starts unwired
// (dropped on the canvas before a target is picked), and the dispatcher
// just skips one that still is at fire time rather than treating it as
// invalid — completing it is a normal edit, not a distinct state.
//
// `params` is used only for device.command: literal values, or `{arg[0]}`/
// `{:name}` tokens the dispatcher substitutes from the firing signal (see
// core/templating.ts) when the owner is a mapping. A schedule has no
// signal to draw from, so its actions' params are always literal — CRON
// firings just never contain a token, not a different code path.
// ─────────────────────────────────────────────────────────────
export const triggerActions = pgTable(
  "trigger_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id").references(() => scheduledJobs.id, { onDelete: "cascade" }),
    mappingId: uuid("mapping_id").references(() => inputMappings.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 50 }).$type<TriggerTargetType>().notNull(),
    targetId: uuid("target_id"),
    targetCommand: varchar("target_command", { length: 100 }),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_trigger_actions_schedule").on(t.scheduleId),
    index("idx_trigger_actions_mapping").on(t.mappingId),
    check(
      "trigger_actions_owner_chk",
      sql`(${t.scheduleId} IS NOT NULL AND ${t.mappingId} IS NULL)
        OR (${t.mappingId} IS NOT NULL AND ${t.scheduleId} IS NULL)`,
    ),
  ],
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
// iframes — external device UIs embedded as a sidebar item each
// (e.g. Pixera Webview). One row = one sidebar entry, no enable flag.
// ─────────────────────────────────────────────────────────────
export const iframes = pgTable("iframes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  url: text("url").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─────────────────────────────────────────────────────────────
// kiosks — wall-screen / tablet layouts (the "Layouts" admin section)
// Each row is one fixed-pixel canvas shown chromeless at /kiosk/:name.
// `name` is unique because it is the lookup key in that URL. The grid
// geometry + placed device tiles live in `config` (KioskConfig).
// ─────────────────────────────────────────────────────────────
export const kiosks = pgTable(
  "kiosks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    config: jsonb("config").$type<KioskConfig>().notNull().default({ columns: 12, cellHeight: 80, tiles: [] }),
    // Front-end-only lock: plain digits, compared client-side. Not a
    // credential, so it isn't hashed — the browser needs the literal
    // value to check it locally. Null = kiosk opens with no PIN gate.
    pin: varchar("pin", { length: 10 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("idx_kiosks_name").on(t.name)],
);
// cameras — RTSP CCTV sources, each rendered as a live-view sidebar
// entry. The server transcodes RTSP → HLS on demand (one ffmpeg
// process per viewed camera); credentials never reach the browser.
// One row = one sidebar entry.
// ─────────────────────────────────────────────────────────────
export const cameras = pgTable("cameras", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  // RTSP base URL WITHOUT credentials: rtsp://host:port/path. The username and
  // password below are injected server-side when ffmpeg connects, so secrets
  // are never serialised into the URL the UI sees.
  url: text("url").notNull(),
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }),
  displayOrder: integer("display_order").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
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
