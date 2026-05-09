import { childLogger } from '../logger.js';
import { query } from './index.js';

const log = childLogger('migrate');

const STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

  `CREATE TABLE IF NOT EXISTS rooms (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100) NOT NULL,
    description   TEXT,
    icon          VARCHAR(50),
    color         VARCHAR(7),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS connections (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100) NOT NULL,
    driver_id     VARCHAR(100) NOT NULL,
    host          VARCHAR(255),
    port          INTEGER,
    protocol      VARCHAR(20) DEFAULT 'tcp',
    config        JSONB NOT NULL DEFAULT '{}',
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    VARCHAR(100) DEFAULT 'admin'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_connections_driver ON connections(driver_id)`,

  `CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id   UUID NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
    room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    type            VARCHAR(50) NOT NULL,
    subtype         VARCHAR(100),
    address         JSONB NOT NULL,
    capabilities    JSONB NOT NULL DEFAULT '[]',
    metadata        JSONB NOT NULL DEFAULT '{}',
    icon            VARCHAR(50),
    display_order   INTEGER NOT NULL DEFAULT 0,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      VARCHAR(100) DEFAULT 'admin'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_devices_room ON devices(room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_connection ON devices(connection_id)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(type)`,

  `CREATE TABLE IF NOT EXISTS scenes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id       UUID REFERENCES rooms(id) ON DELETE SET NULL,
    name          VARCHAR(100) NOT NULL,
    description   TEXT,
    icon          VARCHAR(50),
    color         VARCHAR(7),
    is_favorite   BOOLEAN NOT NULL DEFAULT FALSE,
    tags          TEXT[] NOT NULL DEFAULT '{}',
    variables     JSONB NOT NULL DEFAULT '{}',
    version       INTEGER NOT NULL DEFAULT 1,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    VARCHAR(100) DEFAULT 'admin'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scenes_room ON scenes(room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenes_favorite ON scenes(is_favorite)`,

  `CREATE TABLE IF NOT EXISTS scene_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id    UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    snapshot    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  VARCHAR(100) DEFAULT 'admin',
    UNIQUE(scene_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scene_versions_scene ON scene_versions(scene_id)`,

  `CREATE TABLE IF NOT EXISTS scene_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id        UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    step_order      INTEGER NOT NULL DEFAULT 0,
    parallel_group  INTEGER NOT NULL DEFAULT 0,
    delay_ms        INTEGER NOT NULL DEFAULT 0,
    command         VARCHAR(100) NOT NULL,
    params          JSONB NOT NULL DEFAULT '{}',
    on_failure      VARCHAR(20) NOT NULL DEFAULT 'continue',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scene_actions_scene ON scene_actions(scene_id, step_order)`,

  `CREATE TABLE IF NOT EXISTS scene_executions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id      UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    status        VARCHAR(20) NOT NULL DEFAULT 'running',
    source        VARCHAR(100) NOT NULL,
    source_detail VARCHAR(255),
    pre_state     JSONB,
    error_message TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ,
    duration_ms   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scene_executions_scene ON scene_executions(scene_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scene_executions_status ON scene_executions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_scene_executions_started ON scene_executions(started_at DESC)`,

  `CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100) NOT NULL,
    scene_id      UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    cron          VARCHAR(100) NOT NULL,
    timezone      VARCHAR(50) NOT NULL DEFAULT 'Europe/Prague',
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at   TIMESTAMPTZ,
    next_run_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    VARCHAR(100) DEFAULT 'admin'
  )`,

  `CREATE TABLE IF NOT EXISTS input_mappings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    protocol        VARCHAR(20) NOT NULL,
    pattern         VARCHAR(255) NOT NULL,
    target_type     VARCHAR(50) NOT NULL,
    target_id       UUID,
    target_command  VARCHAR(100),
    params_template JSONB NOT NULL DEFAULT '{}',
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_input_mappings_protocol ON input_mappings(protocol, enabled)`,

  `CREATE TABLE IF NOT EXISTS ui_layouts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS logs (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    level       VARCHAR(10) NOT NULL,
    source      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   UUID,
    message     TEXT NOT NULL,
    metadata    JSONB NOT NULL DEFAULT '{}',
    duration_ms INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_entity ON logs(entity_type, entity_id, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source, ts DESC)`,
  // TimescaleDB hypertable conversion is optional; ignore failure on plain Postgres.

  `CREATE TABLE IF NOT EXISTS config (
    key        VARCHAR(100) PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

export async function migrate(): Promise<void> {
  log.info('Running migrations');
  for (const stmt of STATEMENTS) {
    try {
      await query(stmt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Migration statement failed', { message, stmt: stmt.slice(0, 80) });
      throw err;
    }
  }

  // Try to enable TimescaleDB hypertable for logs (optional).
  try {
    await query(`SELECT create_hypertable('logs', 'ts', if_not_exists => TRUE, migrate_data => TRUE)`);
    log.info('TimescaleDB hypertable enabled for logs');
  } catch (err) {
    log.info('TimescaleDB extension not available — logs will use plain Postgres', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  log.info('Migrations complete');
}
