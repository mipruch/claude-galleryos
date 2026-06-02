/**
 * BssSoundwebDriver tests — driver class against the in-process mock device.
 *
 * Covers the 6 standard driver cases (connect, command, readState, dry-run,
 * unknown-command, disconnect) plus BSS-specific behaviour: subscription push
 * routing and re-subscribe on (re)connect.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  ConnectionConfig,
  DriverContext,
  EndpointDescriptor,
  StateChangeEvent,
} from "@gallery/driver-core";
import BssSoundwebDriver from "../src/index.ts";
import { levelToPercentRaw } from "../src/london-di.ts";
import { startBssMock, type BssMockServer } from "./mock-device.ts";

function testContext(dryRun = false): DriverContext {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage: { async get() { return undefined; }, async set() {}, async delete() {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

// Fader at node 1, audio (vd 3), object 0x100, gain param 0, mute param 1.
const ADDR = { node: 1, virtualDevice: 3, object: 0x100, gainParam: 0, muteParam: 1 };
const endpoint: EndpointDescriptor = {
  id: "fader-1",
  type: "bss-soundweb.fader",
  address: ADDR,
  name: "Channel 1",
};
const gainAddr = { node: 1, virtualDevice: 3, object: 0x100, param: 0 };
const muteAddr = { node: 1, virtualDevice: 3, object: 0x100, param: 1 };

function connConfig(port: number): ConnectionConfig {
  return { id: "conn-1", driver: "bss-soundweb", host: "127.0.0.1", port, config: { responseTimeoutMs: 1000 } };
}

async function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
}

describe("BssSoundwebDriver", () => {
  let mock: BssMockServer;

  beforeEach(() => {
    mock = startBssMock();
  });
  afterEach(() => {
    mock.stop();
  });

  test("1. connect — socket opens, isConnected() true", async () => {
    const driver = new BssSoundwebDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("2. command — setLevel + setMute reach the device", async () => {
    const driver = new BssSoundwebDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const lvl = await driver.executeCommand(endpoint, "setLevel", { level: 0.5 });
    expect(lvl.success).toBe(true);
    await waitFor(() => mock.getValue(gainAddr) !== undefined);
    expect(mock.getValue(gainAddr)).toBe(levelToPercentRaw(0.5));

    const mute = await driver.executeCommand(endpoint, "setMute", { muted: true });
    expect(mute.success).toBe(true);
    await waitFor(() => mock.getValue(muteAddr) !== undefined);
    expect(mock.getValue(muteAddr)).toBe(1);

    await driver.destroy();
  });

  test("3. readState — reflects device state via SUBSCRIBE", async () => {
    const driver = new BssSoundwebDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.executeCommand(endpoint, "setLevel", { level: 0.4 });
    await driver.executeCommand(endpoint, "setMute", { muted: true });

    const state = await driver.readState(endpoint);
    expect(state).toMatchObject({ level: 0.4, muted: true });

    await driver.destroy();
  });

  test("4. dry-run — does not touch the device", async () => {
    const driver = new BssSoundwebDriver();
    await driver.init(connConfig(mock.port), testContext(true));
    await driver.connect();

    const result = await driver.executeCommand(endpoint, "setLevel", { level: 0.8 });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ level: 0.8 });
    // The real device was never addressed.
    expect(mock.getValue(gainAddr)).toBeUndefined();

    await driver.destroy();
  });

  test("5. unknown-command — fails gracefully", async () => {
    const driver = new BssSoundwebDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint, "frobnicate", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("6. disconnect — tears down cleanly", async () => {
    const driver = new BssSoundwebDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.disconnect();
    expect(driver.isConnected()).toBe(false);

    await driver.destroy();
  });

  test("subscription — external value change emits a state event", async () => {
    const driver = new BssSoundwebDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const events: StateChangeEvent[] = [];
    driver.on("state", (e: StateChangeEvent) => events.push(e));

    await driver.subscribeToEndpoint(endpoint);
    // Device-side change pushed to subscribers.
    mock.setValue(gainAddr, levelToPercentRaw(0.7), true);

    await waitFor(() => events.some((e) => e.source === "subscription" && (e.state as { level?: number }).level === 0.7));
    const ev = events.find((e) => e.source === "subscription" && (e.state as { level?: number }).level === 0.7)!;
    expect(ev.endpointId).toBe("fader-1");

    await driver.destroy();
  });

  test("re-subscribe — endpoints subscribed before connect are subscribed on connect", async () => {
    const driver = new BssSoundwebDriver();
    await driver.init(connConfig(mock.port), testContext());

    // Subscribe while offline — must be queued, not sent.
    await driver.subscribeToEndpoint(endpoint);
    expect(mock.received()).toHaveLength(0);

    await driver.connect();
    // On connect the driver re-subscribes everything it tracks.
    await waitFor(() => mock.received().length >= 2);
    // SUBSCRIBE_PERCENT (0x8e) for gain + SUBSCRIBE (0x89) for mute.
    expect(mock.received()).toContain(0x8e);
    expect(mock.received()).toContain(0x89);

    await driver.destroy();
  });
});
