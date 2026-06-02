/**
 * Watchdog tests — hermetic (no DB / Redis / subprocess).
 *
 * Uses fake WatchdogTarget and fake LiveStateStore so the tests run without
 * any infrastructure. Intervals are set to 20 ms so we don't wait long.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Watchdog, type WatchdogTarget } from "../../src/core/Watchdog.ts";
import { EventBus, type GalleryEvent } from "../../src/core/EventBus.ts";
import type { LiveStateStore, ConnectionStatus, DeviceStatus, DeviceRecord } from "../../src/core/DeviceManager.ts";
import type { HealthStatus } from "@gallery/driver-core";
import { logger } from "../../src/logger.ts";

// ── helpers ──────────────────────────────────────────────────

function makeStateStore() {
  const connStatus = new Map<string, ConnectionStatus>();
  const devStatus = new Map<string, DeviceStatus>();

  const store: LiveStateStore = {
    async setDeviceState() {},
    async getDeviceState() { return null; },
    async setDeviceStatus(id, s) { devStatus.set(id, s); },
    async getDeviceStatus(id) { return devStatus.get(id) ?? null; },
    async setConnectionStatus(id, s) { connStatus.set(id, s); },
    async getConnectionStatus(id) { return connStatus.get(id) ?? null; },
  };
  return { store, connStatus, devStatus };
}

function health(online: boolean, latencyMs = 5): HealthStatus {
  return { online, latencyMs, checkedAt: new Date() };
}

function makeDevice(id: string, connectionId: string): DeviceRecord {
  return { id, connectionId, name: id, endpointType: "test.device", address: {} };
}

/** Waits until predicate returns true or times out. */
async function waitFor(pred: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(10);
  }
}

// ── Layer 1: connection health ────────────────────────────────

describe("Watchdog — Layer 1 (connection health)", () => {
  let watchdog: Watchdog;
  const INTERVAL = 20;

  afterEach(() => watchdog.stop());

  test("emits connection.connected when first seen as online", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    const { store } = makeStateStore();

    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-1"],
      healthCheckConnection: async () => health(true),
      devicesForConnection: () => [],
      endpointHealthCheck: async () => null,
    };

    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: INTERVAL, endpointIntervalMs: 60_000 });
    watchdog.start();

    await waitFor(() => events.some((e) => e.type === "connection.connected"));
    expect(events.some((e) => e.type === "connection.connected" && (e as { connectionId: string }).connectionId === "conn-1")).toBe(true);
  });

  test("emits connection.disconnected when online → offline transition", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    const { store, connStatus } = makeStateStore();

    // Seed Redis: currently online.
    connStatus.set("conn-1", { online: true });

    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-1"],
      healthCheckConnection: async () => health(false),
      devicesForConnection: () => [],
      endpointHealthCheck: async () => null,
    };

    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: INTERVAL, endpointIntervalMs: 60_000 });
    watchdog.start();

    await waitFor(() => events.some((e) => e.type === "connection.disconnected"));
    const ev = events.find((e) => e.type === "connection.disconnected") as Extract<GalleryEvent, { type: "connection.disconnected" }>;
    expect(ev?.connectionId).toBe("conn-1");
    expect(connStatus.get("conn-1")?.online).toBe(false);
  });

  test("does NOT re-emit when online status is unchanged", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    const { store, connStatus } = makeStateStore();

    // Seed Redis: already online.
    connStatus.set("conn-1", { online: true });

    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-1"],
      healthCheckConnection: async () => health(true),
      devicesForConnection: () => [],
      endpointHealthCheck: async () => null,
    };

    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: INTERVAL, endpointIntervalMs: 60_000 });
    watchdog.start();

    // Wait for at least two ticks.
    await Bun.sleep(INTERVAL * 3);

    const connEvents = events.filter(
      (e) => e.type === "connection.connected" || e.type === "connection.disconnected",
    );
    expect(connEvents.length).toBe(0);
  });

  test("writes updated connection status to state store on every tick", async () => {
    const { store, connStatus } = makeStateStore();
    const bus = new EventBus();

    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-1"],
      healthCheckConnection: async () => health(true, 12),
      devicesForConnection: () => [],
      endpointHealthCheck: async () => null,
    };

    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: INTERVAL, endpointIntervalMs: 60_000 });
    watchdog.start();

    await waitFor(() => (connStatus.get("conn-1")?.latencyMs ?? 0) > 0);
    expect(connStatus.get("conn-1")?.latencyMs).toBe(12);
    expect(connStatus.get("conn-1")?.online).toBe(true);
  });

  test("swallows healthCheck errors without crashing", async () => {
    const bus = new EventBus();
    const { store } = makeStateStore();

    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-bad"],
      healthCheckConnection: async () => { throw new Error("IPC timeout"); },
      devicesForConnection: () => [],
      endpointHealthCheck: async () => null,
    };

    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: INTERVAL, endpointIntervalMs: 60_000 });
    watchdog.start();

    // Must not throw; Watchdog keeps running.
    await Bun.sleep(INTERVAL * 3);
    expect(watchdog).toBeDefined();
  });
});

// ── Layer 2: endpoint health ──────────────────────────────────

describe("Watchdog — Layer 2 (endpoint health)", () => {
  let watchdog: Watchdog;
  const INTERVAL = 20;

  afterEach(() => watchdog.stop());

  test("emits device.offline on online → offline transition and writes status", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    const { store, devStatus } = makeStateStore();

    // Seed: device was online.
    devStatus.set("dev-1", { online: true });

    const device = makeDevice("dev-1", "conn-1");
    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-1"],
      healthCheckConnection: async () => health(true),
      devicesForConnection: () => [device],
      endpointHealthCheck: async (id) => id === "dev-1" ? health(false) : null,
    };

    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: 60_000, endpointIntervalMs: INTERVAL });
    watchdog.start();

    await waitFor(() => events.some((e) => e.type === "device.offline"));
    const ev = events.find((e) => e.type === "device.offline") as Extract<GalleryEvent, { type: "device.offline" }>;
    expect(ev?.deviceId).toBe("dev-1");
    expect(ev?.connectionId).toBe("conn-1");
    expect(devStatus.get("dev-1")?.online).toBe(false);
  });

  test("emits device.online on offline → online transition", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    const { store, devStatus } = makeStateStore();

    // Seed: device was offline.
    devStatus.set("dev-1", { online: false });

    const device = makeDevice("dev-1", "conn-1");
    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-1"],
      healthCheckConnection: async () => health(true),
      devicesForConnection: () => [device],
      endpointHealthCheck: async () => health(true),
    };

    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: 60_000, endpointIntervalMs: INTERVAL });
    watchdog.start();

    await waitFor(() => events.some((e) => e.type === "device.online"));
    expect(events.some((e) => e.type === "device.online" && (e as { deviceId: string }).deviceId === "dev-1")).toBe(true);
  });

  test("skips endpoint silently when driver returns null (not supported)", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    const { store, devStatus } = makeStateStore();

    const device = makeDevice("dev-no-hc", "conn-1");
    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-1"],
      healthCheckConnection: async () => health(true),
      devicesForConnection: () => [device],
      endpointHealthCheck: async () => null,  // driver doesn't support it
    };

    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: 60_000, endpointIntervalMs: INTERVAL });
    watchdog.start();

    await Bun.sleep(INTERVAL * 3);

    const devEvents = events.filter((e) => e.type === "device.online" || e.type === "device.offline");
    expect(devEvents.length).toBe(0);
    expect(devStatus.get("dev-no-hc")).toBeUndefined();
  });

  test("stagger: multiple devices are distributed across the interval", async () => {
    const checkTimes: number[] = [];
    const bus = new EventBus();
    const { store } = makeStateStore();

    const devices = ["dev-a", "dev-b", "dev-c"].map((id) => makeDevice(id, "conn-1"));
    const target: WatchdogTarget = {
      listRunningConnectionIds: () => ["conn-1"],
      healthCheckConnection: async () => health(true),
      devicesForConnection: () => devices,
      endpointHealthCheck: async () => {
        checkTimes.push(Date.now());
        return health(true);
      },
    };

    // Interval of 60 ms with 3 devices → ~20 ms between each.
    watchdog = new Watchdog({ target, state: store, eventBus: bus, logger, connectionIntervalMs: 60_000, endpointIntervalMs: 60 });
    watchdog.start();

    await waitFor(() => checkTimes.length >= 3, 500);

    // The first and last check should be at least 30 ms apart (60 ms / 3 * 2 * ~0.5 margin).
    const spread = checkTimes[checkTimes.length - 1]! - checkTimes[0]!;
    expect(spread).toBeGreaterThan(20);
  });
});
