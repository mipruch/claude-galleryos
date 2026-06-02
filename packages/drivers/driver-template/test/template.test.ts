/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DRIVER TEMPLATE — test/template.test.ts                                  │
 * │                                                                           │
 * │  The 6 standard cases every driver should cover. Copy this file alongside │
 * │  your driver and adapt the assertions to your protocol. Tests run the     │
 * │  driver class directly (no subprocess) against the bundled mock device.   │
 * │                                                                           │
 * │    1. connect          — handshake succeeds, isConnected() true           │
 * │    2. command          — a command reaches the device                     │
 * │    3. readState        — state is read back and shaped per stateSchema    │
 * │    4. dry-run          — no hardware is touched                           │
 * │    5. unknown-command  — fails gracefully (success:false)                 │
 * │    6. disconnect       — tears down cleanly                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  ConnectionConfig,
  DriverContext,
  EndpointDescriptor,
} from "@gallery/driver-core";
import TemplateDriver from "../src/index.ts";
import { startTemplateMock, type TemplateMockServer } from "./mock-device.ts";

// A self-contained test context (kept inline so the template copies cleanly).
function testContext(dryRun = false): DriverContext {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage: {
      async get() {
        return undefined;
      },
      async set() {},
      async delete() {},
    },
    dryRun,
    signal: new AbortController().signal,
  };
}

const endpoint: EndpointDescriptor = {
  id: "dev-1",
  type: "template.device",
  address: {},
  name: "Test Device",
};

function connConfig(port: number, config: Record<string, unknown> = {}): ConnectionConfig {
  return { id: "conn-1", driver: "template", host: "127.0.0.1", port, config };
}

describe("TemplateDriver", () => {
  let mock: TemplateMockServer;

  beforeEach(() => {
    mock = startTemplateMock();
  });
  afterEach(() => {
    mock.stop();
  });

  test("1. connect — handshake succeeds", async () => {
    const driver = new TemplateDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("2. command — reaches the device", async () => {
    const driver = new TemplateDriver();
    await driver.init(connConfig(mock.port), testContext());

    const on = await driver.executeCommand(endpoint, "on", {});
    expect(on.success).toBe(true);
    expect(mock.state().power).toBe(true);

    const lvl = await driver.executeCommand(endpoint, "setLevel", { level: 0.5 });
    expect(lvl.success).toBe(true);
    expect(mock.state().level).toBe(50);

    await driver.destroy();
  });

  test("3. readState — reflects device state", async () => {
    const driver = new TemplateDriver();
    await driver.init(connConfig(mock.port), testContext());

    await driver.executeCommand(endpoint, "on", {});
    await driver.executeCommand(endpoint, "setLevel", { level: 0.4 });

    const state = await driver.readState(endpoint);
    expect(state).toMatchObject({ power: true, level: 0.4 });

    await driver.destroy();
  });

  test("4. dry-run — does not touch the device", async () => {
    const driver = new TemplateDriver();
    await driver.init(connConfig(mock.port), testContext(true));

    const result = await driver.executeCommand(endpoint, "on", {});
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ power: true });
    // The real device was never told to power on.
    expect(mock.state().power).toBe(false);

    await driver.destroy();
  });

  test("5. unknown-command — fails gracefully", async () => {
    const driver = new TemplateDriver();
    await driver.init(connConfig(mock.port), testContext());

    const result = await driver.executeCommand(endpoint, "frobnicate", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("6. disconnect — tears down cleanly", async () => {
    const driver = new TemplateDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.disconnect();
    expect(driver.isConnected()).toBe(false);

    await driver.destroy();
  });
});
