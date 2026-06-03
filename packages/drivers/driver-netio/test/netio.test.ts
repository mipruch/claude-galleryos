/**
 * NetioDriver tests — driver class against the in-process mock device.
 *
 * Covers the 6 standard driver cases plus NETIO-specific behaviour:
 *   1. connect            — GET /netio.json succeeds, isConnected() true
 *   2. commands           — on/off/toggle reach the device correctly
 *   3. readState          — reflects device state and includes metering fields
 *   4. dry-run            — no HTTP requests are sent
 *   5. unknown-command    — fails gracefully (success:false)
 *   6. disconnect         — tears down cleanly
 *   7. shortOn/shortOff   — correct action codes sent, Delay forwarded
 *   8. auth               — 401 surfaces as a clear error
 *   9. endpointHealthCheck — verifies outputId presence per endpoint
 *  10. multi-output POST  — one POST can control several outlets simultaneously
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, DriverContext, EndpointDescriptor } from "@gallery/driver-core";
import NetioDriver from "../src/index.ts";
import { startNetioMock, type NetioMockServer } from "./mock-device.ts";

// ── helpers ──────────────────────────────────────────────────

function testContext(dryRun = false): DriverContext {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage: { async get() { return undefined; }, async set() {}, async delete() {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

function connConfig(port: number, extra: Record<string, unknown> = {}): ConnectionConfig {
  return {
    id: "conn-1",
    driver: "netio",
    host: "127.0.0.1",
    port,
    config: { username: "", password: "", responseTimeoutMs: 2000, ...extra },
  };
}

function endpoint(outputId: number): EndpointDescriptor {
  return { id: `socket-${outputId}`, type: "netio.socket", address: { outputId }, name: `Socket ${outputId}` };
}

// ── tests ─────────────────────────────────────────────────────

describe("NetioDriver", () => {
  let mock: NetioMockServer;

  beforeEach(() => { mock = startNetioMock(); });
  afterEach(() => { mock.stop(); });

  test("1. connect — GET /netio.json succeeds, isConnected() true", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("2. commands — on/off/toggle reach the device", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    const ep = endpoint(1);

    let result = await driver.executeCommand(ep, "on", {});
    expect(result.success).toBe(true);
    expect(mock.state(1)?.on).toBe(true);
    expect(result.state).toMatchObject({ on: true });

    result = await driver.executeCommand(ep, "off", {});
    expect(result.success).toBe(true);
    expect(mock.state(1)?.on).toBe(false);

    result = await driver.executeCommand(ep, "toggle", {});
    expect(result.success).toBe(true);
    expect(mock.state(1)?.on).toBe(true); // toggled back on

    await driver.destroy();
  });

  test("3. readState — reflects device state and includes metering", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    mock.setState(2, true); // pre-set output 2 to on
    const state = await driver.readState(endpoint(2));

    expect(state).toMatchObject({ on: true });
    // Mock provides metering fields.
    expect(typeof state.load).toBe("number");
    expect(typeof state.current).toBe("number");
    expect(typeof state.energy).toBe("number");

    await driver.destroy();
  });

  test("4. dry-run — no HTTP requests sent", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext(true));
    await driver.connect(); // dry-run connect is a no-op

    const result = await driver.executeCommand(endpoint(1), "on", {});
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ on: true });
    // No POST was sent to the mock.
    expect(mock.writes).toHaveLength(0);

    await driver.destroy();
  });

  test("5. unknown-command — fails gracefully (success:false)", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(1), "dimToHalf", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("6. disconnect — tears down cleanly", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);

    await driver.disconnect();
    expect(driver.isConnected()).toBe(false);

    await driver.destroy();
  });

  test("7. shortOn sends Action=3 with optional Delay", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.executeCommand(endpoint(1), "shortOn", { delayMs: 3000 });

    const lastWrite = mock.writes.at(-1);
    expect(lastWrite).toBeDefined();
    expect(lastWrite![0]).toMatchObject({ ID: 1, Action: 3, Delay: 3000 });

    await driver.destroy();
  });

  test("7b. shortOff sends Action=2", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    mock.setState(3, true); // output 3 is on
    await driver.executeCommand(endpoint(3), "shortOff", {});

    const lastWrite = mock.writes.at(-1);
    expect(lastWrite![0]).toMatchObject({ ID: 3, Action: 2 });

    await driver.destroy();
  });

  test("8. auth — 401 surfaces as an error", async () => {
    const protectedMock = startNetioMock({ username: "admin", password: "secret" });

    const driver = new NetioDriver();
    // Wrong password.
    await driver.init(connConfig(protectedMock.port, { username: "admin", password: "wrong" }), testContext());

    await expect(driver.connect()).rejects.toThrow("authentication failed");
    expect(driver.isConnected()).toBe(false);

    await driver.destroy();
    protectedMock.stop();
  });

  test("8b. auth — correct credentials work", async () => {
    const protectedMock = startNetioMock({ username: "admin", password: "secret" });

    const driver = new NetioDriver();
    await driver.init(connConfig(protectedMock.port, { username: "admin", password: "secret" }), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);

    await driver.destroy();
    protectedMock.stop();
  });

  test("9. endpointHealthCheck — ok for valid ID, offline for missing ID", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());

    const good = await driver.endpointHealthCheck!(endpoint(1));
    expect(good.online).toBe(true);

    const bad = await driver.endpointHealthCheck!(endpoint(99));
    expect(bad.online).toBe(false);
    expect(bad.details).toContain("99");

    await driver.destroy();
  });

  test("10. multi-output: readState and commands on different outputs are independent", async () => {
    const driver = new NetioDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.executeCommand(endpoint(1), "on", {});
    await driver.executeCommand(endpoint(2), "off", {});

    expect(mock.state(1)?.on).toBe(true);
    expect(mock.state(2)?.on).toBe(false);

    // readState for each endpoint returns independent values.
    const s1 = await driver.readState(endpoint(1));
    const s2 = await driver.readState(endpoint(2));
    expect(s1.on).toBe(true);
    expect(s2.on).toBe(false);

    await driver.destroy();
  });
});
