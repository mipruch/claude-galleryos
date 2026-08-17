/**
 * IiyamaProliteDriver tests — driver class against the in-process TCP mock
 * (power off / power query) and a UDP mock (Wake-on-LAN).
 *
 *  1. init            — rejects a missing macAddress
 *  2. connect          — initial probe brings the driver online
 *  3. connect (device off) — a refused connection is not a hard failure
 *  4. off              — sends Power Off, waits for the Comm Control confirmation
 *  5. off (no confirmation) — times out and fails the command
 *  6. on               — sends a correctly-formed WoL magic packet, no TCP traffic
 *  7. readState         — reflects current power state
 *  8. dry-run           — no network traffic at all
 *  9. unknown-command   — fails gracefully
 * 10. healthCheck       — reflects reachability, not power state
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, DriverContext, EndpointDescriptor } from "@gallery/driver-core";
import IiyamaProliteDriver from "../src/index.ts";
import { PowerState } from "../src/iiyama.ts";
import { startIiyamaMock, type IiyamaMockServer } from "./mock-device.ts";
import { startUdpMock, type UdpMockServer } from "./mock-udp-server.ts";

const MAC = "AA:BB:CC:DD:EE:FF";

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
    driver: "iiyama-prolite",
    host: "127.0.0.1",
    port,
    config: { macAddress: MAC, responseTimeoutMs: 500, ...extra },
  };
}

function endpoint(): EndpointDescriptor {
  return { id: "display-1", type: "iiyama-prolite.display", address: {}, name: "Display" };
}

describe("IiyamaProliteDriver", () => {
  let mock: IiyamaMockServer;

  beforeEach(() => {
    mock = startIiyamaMock();
  });
  afterEach(() => {
    mock.stop();
  });

  test("1. init — rejects a missing macAddress", async () => {
    const driver = new IiyamaProliteDriver();
    await expect(
      driver.init(connConfig(mock.port, { macAddress: undefined }), testContext()),
    ).rejects.toThrow("macAddress");
  });

  test("2. connect — initial probe brings the driver online", async () => {
    const driver = new IiyamaProliteDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("3. connect — a refused connection (display off) is not a hard failure", async () => {
    mock.stop(); // nothing listening on this port
    const driver = new IiyamaProliteDriver();
    await driver.init(connConfig(mock.port), testContext());
    await expect(driver.connect()).resolves.toBeUndefined();
    expect(driver.isConnected()).toBe(false);
    await driver.destroy();
  });

  test("4. off — sends Power Off, waits for the Comm Control confirmation", async () => {
    mock = startIiyamaMock({ initialPower: PowerState.ON });
    const driver = new IiyamaProliteDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(), "off", {});
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ power: "off" });
    expect(mock.power()).toBe(PowerState.OFF);
    expect(mock.received()).toContain("a60100000004011801bb");

    await driver.destroy();
  });

  test("5. off — no confirmation from the display times out and fails the command", async () => {
    mock = startIiyamaMock({ silent: true });
    const driver = new IiyamaProliteDriver();
    await driver.init(connConfig(mock.port), testContext());

    const result = await driver.executeCommand(endpoint(), "off", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");

    await driver.destroy();
  });

  test("6. on — sends a correctly-formed WoL magic packet, no TCP traffic", async () => {
    const udp = await startUdpMock();
    const driver = new IiyamaProliteDriver();
    await driver.init(
      connConfig(mock.port, { wolPort: udp.port, broadcastAddress: "127.0.0.1" }),
      testContext(),
    );
    await driver.connect();

    const before = mock.connections();
    const result = await driver.executeCommand(endpoint(), "on", {});
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ power: "on" });
    expect(mock.connections()).toBe(before); // no TCP connection for "on"

    const datagram = await waitForDatagram(udp);
    expect(datagram.bytes.length).toBe(102);
    expect(Array.from(datagram.bytes.slice(0, 6))).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const macBytes = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
    expect(Array.from(datagram.bytes.slice(6, 12))).toEqual(macBytes);

    udp.stop();
    await driver.destroy();
  });

  test("7. readState — reflects current power state", async () => {
    mock = startIiyamaMock({ initialPower: PowerState.ON });
    const driver = new IiyamaProliteDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const state = await driver.readState(endpoint());
    expect(state).toMatchObject({ power: "on" });

    await driver.destroy();
  });

  test("8. dry-run — no network traffic at all", async () => {
    const udp = await startUdpMock();
    const driver = new IiyamaProliteDriver();
    await driver.init(connConfig(mock.port, { wolPort: udp.port }), testContext(true));
    await driver.connect();

    const on = await driver.executeCommand(endpoint(), "on", {});
    expect(on.success).toBe(true);
    expect(on.state).toMatchObject({ power: "on" });

    const off = await driver.executeCommand(endpoint(), "off", {});
    expect(off.success).toBe(true);
    expect(off.state).toMatchObject({ power: "off" });

    expect(mock.received()).toHaveLength(0);
    expect(udp.received()).toHaveLength(0);

    udp.stop();
    await driver.destroy();
  });

  test("9. unknown-command — fails gracefully", async () => {
    const driver = new IiyamaProliteDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(), "setInput", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("10. healthCheck — reflects reachability, not power state", async () => {
    mock = startIiyamaMock({ initialPower: PowerState.OFF });
    const driver = new IiyamaProliteDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const healthy = await driver.healthCheck();
    expect(healthy.online).toBe(true);

    mock.stop();
    const unhealthy = await driver.healthCheck();
    expect(unhealthy.online).toBe(false);

    await driver.destroy();
  });
});

async function waitForDatagram(udp: UdpMockServer, timeoutMs = 1000) {
  const start = Date.now();
  while (udp.received().length === 0) {
    if (Date.now() - start > timeoutMs) throw new Error("waitForDatagram timed out");
    await Bun.sleep(5);
  }
  return udp.received()[0]!;
}
