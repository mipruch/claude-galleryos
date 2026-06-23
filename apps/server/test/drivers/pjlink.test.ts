/**
 * PjlinkDriver unit tests — driver class directly against a mock projector
 * (no subprocess). Verifies protocol encoding, the auth handshake, and dry-run.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, EndpointDescriptor } from "@gallery/driver-core";
import PjlinkDriver from "@gallery/driver-pjlink";
import { startPjlinkMock, type PjlinkMockServer } from "../mocks/mock-devices.ts";
import { testContext } from "../mocks/context.ts";

const endpoint: EndpointDescriptor = {
  id: "dev-1",
  type: "pjlink.projector",
  address: {},
  name: "Test Projector",
};

function connConfig(port: number, config: Record<string, unknown> = {}): ConnectionConfig {
  return { id: "conn-1", driver: "pjlink", host: "127.0.0.1", port, config };
}

describe("PjlinkDriver", () => {
  let mock: PjlinkMockServer;

  beforeEach(() => {
    mock = startPjlinkMock();
  });
  afterEach(() => {
    mock.stop();
  });

  test("connects and reports online", async () => {
    const driver = new PjlinkDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port), ctx);
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("power on/off translates to POWR commands", async () => {
    const driver = new PjlinkDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port), ctx);

    const on = await driver.executeCommand(endpoint, "on", {});
    expect(on.success).toBe(true);
    expect(mock.state().power).toBe("1");

    const off = await driver.executeCommand(endpoint, "off", {});
    expect(off.success).toBe(true);
    expect(mock.state().power).toBe("0");

    await driver.destroy();
  });

  test("setInput resolves friendly names and setMute toggles AV mute", async () => {
    const driver = new PjlinkDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port), ctx);

    await driver.executeCommand(endpoint, "setInput", { input: "HDMI1" });
    expect(mock.state().input).toBe("31");

    await driver.executeCommand(endpoint, "setMute", { muted: true });
    expect(mock.state().avmt).toBe("31");

    await driver.destroy();
  });

  test("readState reflects device state", async () => {
    const driver = new PjlinkDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port), ctx);

    await driver.executeCommand(endpoint, "on", {});
    await driver.executeCommand(endpoint, "setInput", { input: "RGB1" });

    const state = await driver.readState(endpoint);
    expect(state).toMatchObject({ power: "on", input: "11", muted: false });

    await driver.destroy();
  });

  test("unknown command fails gracefully", async () => {
    const driver = new PjlinkDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port), ctx);

    const result = await driver.executeCommand(endpoint, "frobnicate", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("a whole transaction is bounded by responseTimeoutMs, not 3× per phase", async () => {
    // Banner is stalled past the budget; connect + banner + command share one
    // deadline, so the command must fail at ~responseTimeoutMs — well short of
    // the 3× (per-phase) worst case the old code allowed.
    const slow = startPjlinkMock({ bannerDelayMs: 400 });
    const driver = new PjlinkDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(slow.port, { responseTimeoutMs: 200 }), ctx);

    const start = Date.now();
    const result = await driver.executeCommand(endpoint, "on", {});
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    // Bounded by the single 200ms budget (+ scheduling slack), not 600ms.
    expect(elapsed).toBeLessThan(450);

    await driver.destroy();
    slow.stop();
  });

  test("dry-run does not touch the device", async () => {
    const driver = new PjlinkDriver();
    const { ctx } = testContext(true);
    await driver.init(connConfig(mock.port), ctx);

    const result = await driver.executeCommand(endpoint, "on", {});
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ power: "on" });
    // The real device was never told to power on.
    expect(mock.state().power).toBe("0");

    await driver.destroy();
  });
});

describe("PjlinkDriver authentication", () => {
  test("authenticates with the correct password (MD5 digest)", async () => {
    const mock = startPjlinkMock({ password: "secret" });
    const driver = new PjlinkDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port, { password: "secret" }), ctx);

    const result = await driver.executeCommand(endpoint, "on", {});
    expect(result.success).toBe(true);
    expect(mock.state().power).toBe("1");

    await driver.destroy();
    mock.stop();
  });

  test("fails clearly with a wrong password", async () => {
    const mock = startPjlinkMock({ password: "secret" });
    const driver = new PjlinkDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port, { password: "wrong" }), ctx);

    const result = await driver.executeCommand(endpoint, "on", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("authentication");

    await driver.destroy();
    mock.stop();
  });
});
