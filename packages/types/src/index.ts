/**
 * `@gallery/types` — single source of truth for contracts shared between the
 * GalleryOS server and UI: the Drizzle schema, record/DTO types, live-state and
 * WebSocket message types.
 *
 * The UI imports from here with `import type { … }` so the (runtime) Drizzle
 * schema is erased from its bundle. The server imports the schema tables for
 * queries and migrations; the table objects are also available via the
 * `@gallery/types/schema` subpath for `drizzle()` / drizzle-kit.
 */

export * from "./schema.ts";
export * from "./enums.ts";
export * from "./events.ts";
export * from "./kiosk.ts";
export * from "./records.ts";
export * from "./live.ts";
export * from "./messages.ts";
export type { Jsonify } from "./json.ts";
