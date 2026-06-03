/**
 * Drizzle database client, backed by Bun's native SQL driver.
 *
 * `drizzle-orm/bun-sql` runs Drizzle on top of `Bun.sql`, so we get Drizzle's
 * type-safe query builder while still using Bun's native PostgreSQL driver
 * (no `pg`/`postgres.js` dependency).
 */

import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { appConfig } from "../config.ts";
import * as schema from "./schema.ts";

/** Underlying Bun SQL connection (use `.end()` on shutdown). */
export const sqlClient = new SQL(appConfig.db.url);

/** Type-safe Drizzle database handle, schema-aware. */
export const db = drizzle(sqlClient, { schema });


/** Close the database connection pool. */
export async function closeDb(): Promise<void> {
  await sqlClient.end();
}
