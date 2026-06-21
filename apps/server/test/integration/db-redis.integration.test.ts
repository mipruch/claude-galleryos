/**
 * Live integration test — exercises the REAL Postgres (Drizzle) repository and
 * REAL Redis state store, end to end:
 *
 *   DB (dbRepo) → DeviceManager → DriverHost (IPC) → PJLink driver → mock device
 *                                      ↓
 *                              Redis (redisStateStore)
 *
 * Skipped by default so `bun test` stays hermetic. Enable with:
 *   GALLERY_INTEGRATION=1 bun test test/integration
 * Requires Postgres + Redis up and migrations applied.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DeviceManager } from "../../src/core/DeviceManager.ts";
import { EventBus } from "../../src/core/EventBus.ts";
import { db } from "../../src/db/client.ts";
import { connections, devices } from "@gallery/types/schema";
import { dbRepo } from "../../src/db/repositories.ts";
import { redisDriverStore, redisStateStore } from "../../src/redis/state.ts";
import { logger } from "../../src/logger.ts";
import { startPjlinkMock, type PjlinkMockServer } from "../mocks/mock-devices.ts";

const ENABLED = process.env.GALLERY_INTEGRATION === "1";
const it = ENABLED ? test : test.skip;

const connId = crypto.randomUUID();
const devId = crypto.randomUUID();
let mock: PjlinkMockServer;
let dm: DeviceManager;

beforeAll(async () => {
  if (!ENABLED) return;
  mock = startPjlinkMock();
  await db.insert(connections).values({
    id: connId,
    name: "itest-pjlink",
    driverId: "pjlink",
    host: "127.0.0.1",
    port: mock.port,
    config: {},
  });
  await db.insert(devices).values({
    id: devId,
    connectionId: connId,
    name: "itest-projector",
    type: "video",
    subtype: "pjlink.projector",
    address: {},
    capabilities: ["on", "off"],
  });
});

afterAll(async () => {
  if (!ENABLED) return;
  await dm?.stop();
  await db.delete(devices).where(eq(devices.id, devId));
  await db.delete(connections).where(eq(connections.id, connId));
  mock?.stop();
});

it("loads from DB, executes a command, and stores live state in Redis", async () => {
  dm = new DeviceManager({
    repo: dbRepo,
    state: redisStateStore,
    eventBus: new EventBus(),
    logger,
    driverKVStore: redisDriverStore,
    commandTimeoutMs: 5_000,
  });
  await dm.start();

  const result = await dm.execute(devId, "on", {});
  expect(result.success).toBe(true);
  expect(mock.state().power).toBe("1");

  const live = await redisStateStore.getDeviceState(devId);
  expect(live).toMatchObject({ power: "on" });
}, 30_000);
