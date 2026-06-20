/**
 * Migration runner.
 *
 * 1. Applies generated Drizzle migrations (creates/updates all tables).
 * 2. Applies TimescaleDB-specific setup for the `logs` table — hypertable,
 *    compression, and retention — which can't be expressed in plain Drizzle DDL.
 *    This block is idempotent and degrades gracefully if the TimescaleDB
 *    extension isn't installed (plain PostgreSQL dev).
 *
 * Run with `bun run migrate` (from apps/server) or `bun src/db/migrate.ts`.
 */

import { migrate } from "drizzle-orm/bun-sql/migrator";
import { errMsg } from "@gallery/driver-core";
import { appConfig } from "../config.ts";
import { logger } from "../logger.ts";
import { closeDb, db, sqlClient } from "./client.ts";

const log = logger.child("migrate");
const migrationsFolder = new URL("./migrations", import.meta.url).pathname;

async function setupTimescale(): Promise<void> {
  try {
    await sqlClient`CREATE EXTENSION IF NOT EXISTS timescaledb`;
    await sqlClient`SELECT create_hypertable('logs', 'ts', if_not_exists => TRUE, migrate_data => TRUE)`;
    await sqlClient`
      ALTER TABLE logs SET (
        timescaledb.compress,
        timescaledb.compress_orderby = 'ts DESC',
        timescaledb.compress_segmentby = 'source, level'
      )`;
    await sqlClient`SELECT add_compression_policy('logs', INTERVAL '7 days', if_not_exists => TRUE)`;
    await sqlClient`SELECT add_retention_policy('logs', make_interval(days => ${appConfig.log.retentionDays}), if_not_exists => TRUE)`;
    log.info("TimescaleDB hypertable configured for 'logs'");
  } catch (err) {
    log.warn("TimescaleDB setup skipped (extension unavailable?)", {
      error: errMsg(err),
    });
  }
}

async function main(): Promise<void> {
  log.info("Running migrations", { migrationsFolder });
  await migrate(db, { migrationsFolder });
  log.info("Drizzle migrations applied");
  await setupTimescale();
  await closeDb();
  log.info("Migration complete");
}

await main();
