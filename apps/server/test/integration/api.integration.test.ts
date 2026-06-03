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
  scenesRepo,
} from "../../src/db/repositories.ts";
import { redisDriverStore, redisSceneStore, redisStateStore } from "../../src/redis/state.ts";
import { SceneEngine } from "../../src/core/SceneEngine.ts";
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
let sceneId = "";

async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 4_000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
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
  const sceneEngine = new SceneEngine({
    scenes: scenesRepo,
    executions: sceneExecutionsRepo,
    state: redisSceneStore,
    deviceManager: dm,
    devices: devicesRepo,
    eventBus: bus,
    logger,
  });
  sceneEngine.start();
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
      scenes: scenesRepo,
      sceneExecutions: sceneExecutionsRepo,
      sceneEngine,
      startedAt: Date.now(),
    },
    0,
  );
  base = `http://localhost:${server.port}`;
});

afterAll(async () => {
  if (!ENABLED) return;
  if (sceneId) await fetch(`${base}/api/v1/scenes/${sceneId}`, { method: "DELETE" }).catch(() => {});
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

it("creates, dry-runs, and executes a scene (real repos + engine)", async () => {
  // Create a scene whose single action powers the device on.
  let res = await fetch(`${base}/api/v1/scenes`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({
      name: "itest-scene",
      actions: [{ deviceId: devId, command: "on", parallelGroup: 0 }],
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string; actions: unknown[] };
  sceneId = created.id;
  expect(created.actions).toHaveLength(1);

  // GET returns the scene with its ordered actions.
  res = await fetch(`${base}/api/v1/scenes/${sceneId}`);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { actions: unknown[] }).actions).toHaveLength(1);

  // Dry-run touches no hardware but returns the plan.
  res = await fetch(`${base}/api/v1/scenes/${sceneId}/execute/dry-run`, { method: "POST" });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { actions: unknown[]; dryRun: boolean }).actions).toHaveLength(1);

  // Real execution: powers the device on and records an execution row.
  res = await fetch(`${base}/api/v1/scenes/${sceneId}/execute`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ source: "itest" }),
  });
  expect(res.status).toBe(202);
  const ack = (await res.json()) as { executionId: string; status: string };
  expect(ack.status).toBe("running");

  await waitFor(() => mock.state().power === "1");

  // The execution history eventually shows a completed run.
  await waitFor(async () => {
    const r = await fetch(`${base}/api/v1/scenes/${sceneId}/executions`);
    const rows = (await r.json()) as Array<{ status: string }>;
    return rows.some((x) => x.status === "completed");
  });
}, 30_000);
