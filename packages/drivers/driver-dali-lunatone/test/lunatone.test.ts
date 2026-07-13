/**
 * DaliLunatoneDriver tests — driver class against the in-process mock gateway.
 *
 * Covers the 6 standard driver cases (connect, command, readState, dry-run,
 * unknown-command, disconnect) plus two KV-store-backed behaviours, both
 * scoped entirely to this driver (the core/UI never know about either):
 *   - brightness preservation: a DALI fixture reports `dimmable.status: 0`
 *     whenever it's physically off, but the driver remembers the last
 *     non-zero level and restores it in `readState` so a fader stays put
 *     across an off/on cycle — even across a driver restart.
 *   - power gating: `switchable` and `dimmable` are independent gateway
 *     features, so a `setBrightness` while off never reaches the gateway at
 *     all — only remembered — and `on` restores it in the same request.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, DriverContext, DriverKVStore, EndpointDescriptor } from "@gallery/driver-core";
import DaliLunatoneDriver from "../src/index.ts";
import { startDaliLunatoneMock, type DaliLunatoneMockServer } from "./mock-device.ts";

/** A bare in-memory KV store — stands in for the Redis-backed one in production. */
function memoryStore(): DriverKVStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<void> {
      map.delete(key);
    },
  };
}

function testContext(storage: DriverKVStore = memoryStore(), dryRun = false): DriverContext {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage,
    dryRun,
    signal: new AbortController().signal,
  };
}

function connConfig(port: number): ConnectionConfig {
  return { id: "conn-1", driver: "dali-lunatone", host: "127.0.0.1", port, config: {} };
}

const endpoint: EndpointDescriptor = {
  id: "fixture-1",
  type: "dali.fixture",
  address: { deviceId: 1 },
  name: "Spot 1",
};

describe("DaliLunatoneDriver", () => {
  let mock: DaliLunatoneMockServer;

  beforeEach(() => {
    mock = startDaliLunatoneMock([1]);
  });
  afterEach(() => {
    mock.stop();
  });

  test("1. connect — reachable, isConnected() true", async () => {
    const driver = new DaliLunatoneDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("2. command — on / setBrightness reach the device", async () => {
    const driver = new DaliLunatoneDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const on = await driver.executeCommand(endpoint, "on", {});
    expect(on.success).toBe(true);
    expect(mock.fixture(1)?.switchable).toBe(true);

    const bright = await driver.executeCommand(endpoint, "setBrightness", { level: 0.6 });
    expect(bright.success).toBe(true);
    expect(mock.fixture(1)?.dimmable).toBe(60);

    await driver.destroy();
  });

  test("3. readState — reflects device state", async () => {
    const driver = new DaliLunatoneDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    mock.setFixture(1, { switchable: true, dimmable: 75 });
    const state = await driver.readState(endpoint);
    expect(state).toEqual({ power: true, brightness: 0.75 });

    await driver.destroy();
  });

  test("4. dry-run — does not touch the device", async () => {
    const driver = new DaliLunatoneDriver();
    await driver.init(connConfig(mock.port), testContext(memoryStore(), true));
    await driver.connect();

    const result = await driver.executeCommand(endpoint, "setBrightness", { level: 0.5 });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ brightness: 0.5 });
    expect(mock.fixture(1)?.dimmable).toBe(0); // real device untouched

    await driver.destroy();
  });

  test("5. unknown-command — fails gracefully", async () => {
    const driver = new DaliLunatoneDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint, "frobnicate", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("6. disconnect — tears down cleanly", async () => {
    const driver = new DaliLunatoneDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.disconnect();
    expect(driver.isConnected()).toBe(false);

    await driver.destroy();
  });

  describe("brightness preservation while off", () => {
    test("readState substitutes the last known non-zero brightness when off", async () => {
      const driver = new DaliLunatoneDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint, "setBrightness", { level: 0.7 });
      // Physically turned off — real hardware now reports dimmable:0 too.
      mock.setFixture(1, { switchable: false });

      const state = await driver.readState(endpoint);
      expect(state).toEqual({ power: false, brightness: 0.7 });

      await driver.destroy();
    });

    test("a genuine 0% while still on is reported as 0, not substituted", async () => {
      const driver = new DaliLunatoneDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint, "setBrightness", { level: 0.7 });
      mock.setFixture(1, { switchable: true, dimmable: 0 }); // on, dimmed to 0%

      const state = await driver.readState(endpoint);
      expect(state).toEqual({ power: true, brightness: 0 });

      await driver.destroy();
    });

    test("survives a driver restart — persisted via the per-connection KV store", async () => {
      const sharedStorage = memoryStore();

      const first = new DaliLunatoneDriver();
      await first.init(connConfig(mock.port), testContext(sharedStorage));
      await first.connect();
      await first.executeCommand(endpoint, "setBrightness", { level: 0.42 });
      await first.destroy();

      mock.setFixture(1, { switchable: false }); // turned off before the "restart"

      const second = new DaliLunatoneDriver();
      await second.init(connConfig(mock.port), testContext(sharedStorage));
      await second.connect();
      const state = await second.readState(endpoint);
      expect(state).toEqual({ power: false, brightness: 0.42 });

      await second.destroy();
    });

    test("no remembered brightness — off simply reports 0, nothing invented", async () => {
      const driver = new DaliLunatoneDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      const state = await driver.readState(endpoint);
      expect(state).toEqual({ power: false, brightness: 0 });

      await driver.destroy();
    });
  });

  describe("power gating — setBrightness while off never reaches the gateway", () => {
    test("setBrightness while off is remembered, not sent — command still succeeds", async () => {
      const driver = new DaliLunatoneDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint, "off", {});
      const result = await driver.executeCommand(endpoint, "setBrightness", { level: 0.23 });

      expect(result.success).toBe(true);
      expect(result.state).toEqual({ brightness: 0.23 });
      expect(mock.fixture(1)?.dimmable).toBe(0); // never reached the device

      await driver.destroy();
    });

    test("on restores the brightness that was set while off, in the same request", async () => {
      const driver = new DaliLunatoneDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint, "off", {});
      await driver.executeCommand(endpoint, "setBrightness", { level: 0.23 });

      const result = await driver.executeCommand(endpoint, "on", {});
      expect(result.success).toBe(true);
      expect(result.state).toEqual({ power: true, brightness: 0.23 });
      expect(mock.fixture(1)?.switchable).toBe(true);
      expect(mock.fixture(1)?.dimmable).toBe(23);

      await driver.destroy();
    });

    test("a live setBrightness echoes power = level > 0 (the gateway derives switchable from dimmable)", async () => {
      const driver = new DaliLunatoneDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint, "on", {});
      const result = await driver.executeCommand(endpoint, "setBrightness", { level: 0 });

      expect(result.state).toEqual({ power: false, brightness: 0 });
      expect(mock.fixture(1)?.switchable).toBe(false); // the gateway's own coupling, not this driver's doing

      await driver.destroy();
    });

    test("dimming to 0 while on doesn't gate later commits — no fader-drag deadlock", async () => {
      const driver = new DaliLunatoneDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint, "on", {});
      // The gateway now reports the fixture as off (see the test above) — but
      // that was never an explicit `off`, so the gating flag must stay "on".
      await driver.executeCommand(endpoint, "setBrightness", { level: 0 });

      const result = await driver.executeCommand(endpoint, "setBrightness", { level: 0.4 });
      expect(result.success).toBe(true);
      expect(result.state).toEqual({ power: true, brightness: 0.4 });
      expect(mock.fixture(1)?.dimmable).toBe(40); // still reached the device — no explicit `off` ever happened

      await driver.destroy();
    });

    test("gating survives a driver restart via the shared KV store", async () => {
      const sharedStorage = memoryStore();

      const first = new DaliLunatoneDriver();
      await first.init(connConfig(mock.port), testContext(sharedStorage));
      await first.connect();
      await first.executeCommand(endpoint, "off", {});
      await first.destroy();

      const second = new DaliLunatoneDriver();
      await second.init(connConfig(mock.port), testContext(sharedStorage));
      await second.connect();
      const result = await second.executeCommand(endpoint, "setBrightness", { level: 0.5 });

      expect(result.state).toEqual({ brightness: 0.5 });
      expect(mock.fixture(1)?.dimmable).toBe(0); // still gated — the "off" was remembered, not re-derived

      await second.destroy();
    });
  });
});
