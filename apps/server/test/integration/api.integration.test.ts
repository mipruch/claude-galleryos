/**
 * Live API integration test — REST + WebSocket against real Postgres/Redis.
 *
 * Flow: create a connection + device via REST (which starts a real DriverHost
 * pointed at a mock PJLink), send a command via REST and via WebSocket, and
 * assert the device changed, live state landed in Redis, and the change was
 * broadcast over WebSocket.
 *
 * Skipped unless GALLERY_INTEGRATION=1. Requires infra up + migrations applied.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { DeviceManager } from "../../src/core/DeviceManager.ts";
import { EventBus } from "../../src/core/EventBus.ts";
import { driverRegistry } from "../../src/core/DriverRegistry.ts";
import {
  connectionsRepo,
  dbRepo,
  devicesRepo,
  logsRepo,
  roomsRepo,
  sceneExecutionsRepo,
} from "../../src/db/repositories.ts";
import { redisDriverStore, redisStateStore } from "../../src/redis/state.ts";
import { startApiServer } from "../../src/api/server.ts";
import { logger } from "../../src/logger.ts";
import { startPjlinkMock, type PjlinkMockServer } from "../mocks/mock-devices.ts";

const ENABLED = process.env.GALLERY_INTEGRATION === "1";
const it = ENABLED ? test : test.skip;

const J = { "content-type": "application/json" };
let server: ReturnType<typeof startApiServer>;
let dm: DeviceManager;
let mock: PjlinkMockServer;
let base = "";
let connId = "";
let devId = "";

async function waitFor(pred: () => boolean, timeoutMs = 4_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(25);
  }
}

beforeAll(async () => {
  if (!ENABLED) return;
  mock = startPjlinkMock();
  const bus = new EventBus();
  dm = new DeviceManager({
    repo: dbRepo,
    state: redisStateStore,
    eventBus: bus,
    logger,
    driverKVStore: redisDriverStore,
    commandTimeoutMs: 5_000,
  });
  await dm.start();
  server = startApiServer(
    {
      deviceManager: dm,
      driverRegistry,
      state: redisStateStore,
      eventBus: bus,
      rooms: roomsRepo,
      connections: connectionsRepo,
      devices: devicesRepo,
      logs: logsRepo,
      sceneExecutions: sceneExecutionsRepo,
      startedAt: Date.now(),
    },
    0,
  );
  base = `http://localhost:${server.port}`;
});

afterAll(async () => {
  if (!ENABLED) return;
  if (devId) await fetch(`${base}/api/v1/devices/${devId}`, { method: "DELETE" }).catch(() => {});
  if (connId) await fetch(`${base}/api/v1/connections/${connId}`, { method: "DELETE" }).catch(() => {});
  server?.stop(true);
  await dm?.stop();
  mock?.stop();
});

it("creates a connection + device and controls it via REST", async () => {
  let res = await fetch(`${base}/api/v1/connections`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ name: "itest", driverId: "pjlink", host: "127.0.0.1", port: mock.port }),
  });
  expect(res.status).toBe(201);
  connId = ((await res.json()) as { id: string }).id;

  res = await fetch(`${base}/api/v1/devices`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({
      connectionId: connId,
      name: "itest-proj",
      type: "video",
      subtype: "pjlink.projector",
      address: {},
    }),
  });
  expect(res.status).toBe(201);
  devId = ((await res.json()) as { id: string }).id;

  await Bun.sleep(300); // let the host connect

  res = await fetch(`${base}/api/v1/devices/${devId}/command`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ command: "on" }),
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { success: boolean }).success).toBe(true);
  expect(mock.state().power).toBe("1");

  res = await fetch(`${base}/api/v1/devices/${devId}/state`);
  expect(await res.json()).toMatchObject({ power: "on" });
}, 30_000);

it("rejects unknown endpoint types and unknown drivers (validation)", async () => {
  let res = await fetch(`${base}/api/v1/connections`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ name: "bad", driverId: "does-not-exist" }),
  });
  expect(res.status).toBe(400);

  res = await fetch(`${base}/api/v1/devices`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({
      connectionId: connId,
      name: "bad-dev",
      type: "video",
      subtype: "pjlink.not-a-type",
      address: {},
    }),
  });
  expect(res.status).toBe(400);
}, 30_000);

it("broadcasts state changes over WebSocket and accepts device:command", async () => {
  const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
  const messages: Array<{ event: string; data: unknown }> = [];
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws connection error"));
  });
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));

  ws.send(JSON.stringify({ event: "device:command", data: { deviceId: devId, command: "off" } }));

  await waitFor(() => messages.some((m) => m.event === "device:command:ack"));
  expect(mock.state().power).toBe("0");
  await waitFor(() => messages.some((m) => m.event === "device:state"));
  ws.close();
}, 30_000);
