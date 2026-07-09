/**
 * SamsungMdcDriver tests — driver class against the in-process MDC mock.
 *
 *  1. connect            — socket opens, isConnected() true
 *  2. commands           — on/off reach the device
 *  3. readState          — reflects current power state
 *  4. dry-run            — no traffic is sent
 *  5. unknown-command    — fails gracefully (success:false)
 *  6. disconnect         — tears down cleanly
 *  7. multiple displays  — share one connection, addressed by displayId
 *  8. range validation   — out-of-range displayId → success:false
 *  9. NAK                — an unknown display id surfaces as a failed command
 * 10. endpointHealthCheck — per-display probe
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, DriverContext, EndpointDescriptor } from "@gallery/driver-core";
import SamsungMdcDriver from "../src/index.ts";
import { PowerState } from "../src/mdc.ts";
import { startMdcMock, type MdcMockServer } from "./mock-device.ts";

// ── helpers ──────────────────────────────────────────────────

function testContext(dryRun = false): DriverContext {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage: {
      async get() { return undefined; },
      async set() {},
      async delete() {},
    },
    dryRun,
    signal: new AbortController().signal,
  };
}

function connConfig(port: number, extra: Record<string, unknown> = {}): ConnectionConfig {
  return {
    id: "conn-1",
    driver: "samsung-mdc",
    host: "127.0.0.1",
    port,
    config: { responseTimeoutMs: 1000, ...extra },
  };
}

function endpoint(displayId: number): EndpointDescriptor {
  return {
    id: `display-${displayId}`,
    type: "samsung-mdc.display",
    address: { displayId },
    name: `Display ${displayId}`,
  };
}

// ── tests ─────────────────────────────────────────────────────

describe("SamsungMdcDriver", () => {
  let mock: MdcMockServer;

  beforeEach(() => {
    mock = startMdcMock({ displayIds: [1, 2, 3] });
  });
  afterEach(() => {
    mock.stop();
  });

  test("1. connect — socket opens, isConnected() true", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("2. commands — on/off reach the device", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const on = await driver.executeCommand(endpoint(1), "on", {});
    expect(on.success).toBe(true);
    expect(on.state).toMatchObject({ power: "on" });
    expect(mock.powerOf(1)).toBe(PowerState.ON);

    const off = await driver.executeCommand(endpoint(1), "off", {});
    expect(off.success).toBe(true);
    expect(off.state).toMatchObject({ power: "off" });
    expect(mock.powerOf(1)).toBe(PowerState.OFF);

    await driver.destroy();
  });

  test("3. readState — reflects current power state", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.executeCommand(endpoint(2), "on", {});
    const state = await driver.readState(endpoint(2));
    expect(state).toMatchObject({ power: "on" });

    await driver.destroy();
  });

  test("4. dry-run — no traffic is sent", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext(true));
    await driver.connect();

    const result = await driver.executeCommand(endpoint(1), "on", {});
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ power: "on" });

    const state = await driver.readState(endpoint(1));
    expect(state).toMatchObject({ power: "on" });
    expect(mock.received()).toHaveLength(0);

    await driver.destroy();
  });

  test("5. unknown-command — fails gracefully", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(1), "setInput", { input: "HDMI1" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("6. disconnect — tears down cleanly", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    await driver.disconnect();
    expect(driver.isConnected()).toBe(false);
    await driver.destroy();
  });

  test("7. multiple displays share one connection, addressed by displayId", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.executeCommand(endpoint(1), "on", {});
    await driver.executeCommand(endpoint(2), "off", {});
    await driver.executeCommand(endpoint(3), "on", {});

    expect(mock.powerOf(1)).toBe(PowerState.ON);
    expect(mock.powerOf(2)).toBe(PowerState.OFF);
    expect(mock.powerOf(3)).toBe(PowerState.ON);

    await driver.destroy();
  });

  test("8. range validation — out-of-range displayId → success:false", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(0), "on", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("invalid address");

    await driver.destroy();
  });

  test("9. NAK — an unknown display id surfaces as a failed command", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(99), "on", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("NAK");

    await driver.destroy();
  });

  test("10. endpointHealthCheck — per-display probe", async () => {
    const driver = new SamsungMdcDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const healthy = await driver.endpointHealthCheck!(endpoint(1));
    expect(healthy.online).toBe(true);

    const unhealthy = await driver.endpointHealthCheck!(endpoint(99));
    expect(unhealthy.online).toBe(false);

    await driver.destroy();
  });
});
