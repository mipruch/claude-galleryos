/**
 * DeviceManager tests — hermetic (no DB/Redis).
 *
 * Uses fake repo + fake live-state store, but a REAL DriverHost subprocess and
 * a mock PJLink device, so it exercises the full path:
 *   DeviceManager → DriverHost (IPC) → PJLink driver → mock device
 * and verifies state mirroring + EventBus emissions.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DeviceManager } from "../../src/core/DeviceManager.ts";
import type {
  ConnectionRecord,
  ConnectionStatus,
  DeviceManagerRepo,
  DeviceRecord,
  DeviceStatus,
  LiveStateStore,
} from "../../src/core/DeviceManager.ts";
import { EventBus, type GalleryEvent } from "../../src/core/EventBus.ts";
import { logger } from "../../src/logger.ts";
import { memoryStore } from "../mocks/context.ts";
import { startPjlinkMock, type PjlinkMockServer } from "../mocks/mock-devices.ts";
import { startBssMock, type BssMockServer } from "../../../../packages/drivers/driver-bss/test/mock-device.ts";

const CONN_ID = "conn-1";
const DEV_ID = "dev-1";

// London DI message types observed by the BSS mock.
const SUBSCRIBE_PERCENT = 0x8e;
const SUBSCRIBE = 0x89;

function makeRepo(port: number): DeviceManagerRepo {
  const connection: ConnectionRecord = {
    id: CONN_ID,
    driverId: "pjlink",
    host: "127.0.0.1",
    port,
    config: {},
  };
  const device: DeviceRecord = {
    id: DEV_ID,
    connectionId: CONN_ID,
    name: "Projector",
    endpointType: "pjlink.projector",
    address: {},
  };
  return {
    async listEnabledConnections() {
      return [connection];
    },
    async listDevicesByConnection(id) {
      return id === CONN_ID ? [device] : [];
    },
    async getDevice(id) {
      return id === DEV_ID ? device : undefined;
    },
  };
}

function makeFakeState() {
  const deviceState = new Map<string, Record<string, unknown>>();
  const deviceStatus = new Map<string, DeviceStatus>();
  const connectionStatus = new Map<string, ConnectionStatus>();
  const store: LiveStateStore = {
    async setDeviceState(id, s) {
      deviceState.set(id, s);
    },
    async getDeviceState(id) {
      return deviceState.get(id) ?? null;
    },
    async setDeviceStatus(id, s) {
      deviceStatus.set(id, s);
    },
    async getDeviceStatus(id) {
      return deviceStatus.get(id) ?? null;
    },
    async setConnectionStatus(id, s) {
      connectionStatus.set(id, s);
    },
    async getConnectionStatus(id) {
      return connectionStatus.get(id) ?? null;
    },
  };
  return { store, deviceState, deviceStatus, connectionStatus };
}

async function waitFor(pred: () => boolean, timeoutMs = 4_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(25);
  }
}

describe("DeviceManager", () => {
  let mock: PjlinkMockServer;
  let dm: DeviceManager;

  beforeEach(() => {
    mock = startPjlinkMock();
  });
  afterEach(async () => {
    await dm.stop();
    mock.stop();
  });

  test("starts connections and marks devices online", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    const state = makeFakeState();

    dm = new DeviceManager({
      repo: makeRepo(mock.port),
      state: state.store,
      eventBus: bus,
      logger,
      driverKVStore: () => memoryStore(),
      commandTimeoutMs: 5_000,
    });

    await dm.start();
    await waitFor(() => events.some((e) => e.type === "connection.connected"));

    expect(events.some((e) => e.type === "device.online" && e.deviceId === DEV_ID)).toBe(true);
    expect(state.connectionStatus.get(CONN_ID)?.online).toBe(true);
  }, 20_000);

  test("execute runs a command, mirrors state, and emits an event", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    const state = makeFakeState();

    dm = new DeviceManager({
      repo: makeRepo(mock.port),
      state: state.store,
      eventBus: bus,
      logger,
      driverKVStore: () => memoryStore(),
      commandTimeoutMs: 5_000,
    });
    await dm.start();

    const result = await dm.execute(DEV_ID, "on", {});
    expect(result.success).toBe(true);
    expect(mock.state().power).toBe("1");
    expect(state.deviceState.get(DEV_ID)).toMatchObject({ power: "on" });

    const changed = events.find(
      (e): e is Extract<GalleryEvent, { type: "device.state.changed" }> =>
        e.type === "device.state.changed" && (e as { deviceId: string }).deviceId === DEV_ID,
    );
    expect(changed).toBeDefined();

    // readState serves the cached value from the state store.
    const read = await dm.readState(DEV_ID);
    expect(read).toMatchObject({ power: "on" });
  }, 20_000);
});

/**
 * Regression: a subscription-capable driver must have its endpoints subscribed
 * automatically when the connection comes online — otherwise the device never
 * pushes state (the gap that left BSS faders silent on first connect). Uses the
 * real BSS driver subprocess + its mock device so SUBSCRIBE frames are observable.
 */
describe("DeviceManager — auto-subscribe on connect", () => {
  let bss: BssMockServer;
  let dm: DeviceManager;

  function makeBssRepo(port: number): DeviceManagerRepo {
    const connection: ConnectionRecord = {
      id: CONN_ID,
      driverId: "bss-soundweb",
      host: "127.0.0.1",
      port,
      config: { responseTimeoutMs: 1000 },
    };
    const device: DeviceRecord = {
      id: DEV_ID,
      connectionId: CONN_ID,
      name: "Fader 1",
      endpointType: "bss-soundweb.fader",
      address: { node: 1, virtualDevice: 3, object: 0x100, gainParam: 0, muteParam: 1 },
    };
    return {
      async listEnabledConnections() {
        return [connection];
      },
      async listDevicesByConnection(id) {
        return id === CONN_ID ? [device] : [];
      },
      async getDevice(id) {
        return id === DEV_ID ? device : undefined;
      },
    };
  }

  beforeEach(() => {
    bss = startBssMock();
  });
  afterEach(async () => {
    await dm.stop();
    bss.stop();
  });

  test("subscribes endpoints when supportsSubscriptions is true", async () => {
    const bus = new EventBus();
    dm = new DeviceManager({
      repo: makeBssRepo(bss.port),
      state: makeFakeState().store,
      eventBus: bus,
      logger,
      driverKVStore: () => memoryStore(),
      supportsSubscriptions: () => true,
      commandTimeoutMs: 5_000,
    });

    await dm.start();
    // The device should receive SUBSCRIBE_PERCENT (gain) + SUBSCRIBE (mute).
    await waitFor(() => bss.received().includes(SUBSCRIBE_PERCENT) && bss.received().includes(SUBSCRIBE));
    expect(bss.received()).toContain(SUBSCRIBE_PERCENT);
    expect(bss.received()).toContain(SUBSCRIBE);
  }, 20_000);

  test("does NOT subscribe when the capability predicate is omitted", async () => {
    const bus = new EventBus();
    const events: GalleryEvent[] = [];
    bus.onAny((e) => events.push(e));
    dm = new DeviceManager({
      repo: makeBssRepo(bss.port),
      state: makeFakeState().store,
      eventBus: bus,
      logger,
      driverKVStore: () => memoryStore(),
      // supportsSubscriptions omitted → poll-only behaviour
      commandTimeoutMs: 5_000,
    });

    await dm.start();
    await waitFor(() => events.some((e) => e.type === "connection.connected"));
    await Bun.sleep(200); // give any (unwanted) subscribe traffic time to arrive
    expect(bss.received()).toHaveLength(0);
  }, 20_000);
});
