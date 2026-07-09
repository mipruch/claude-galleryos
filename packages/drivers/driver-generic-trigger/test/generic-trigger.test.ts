/**
 * GenericTriggerDriver tests — driver class against in-process TCP/UDP mocks.
 *
 * Covers: connect/health (always online — see manifest.ts), tcp send (with
 * and without the delimiter, custom delimiter), udp send, osc send (address
 * only, with args, invalid address), dry-run (no traffic), unknown command,
 * and unreachable-host failure.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { encodeOscMessage, parseOscArgs, type ConnectionConfig, type DriverContext, type EndpointDescriptor } from "@gallery/driver-core";
import GenericTriggerDriver from "../src/index.ts";
import { startTcpMock, type TcpMockServer } from "./mock-tcp-server.ts";
import { startUdpMock, type UdpMockServer } from "./mock-udp-server.ts";

function testContext(dryRun = false): DriverContext {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage: { async get() { return undefined; }, async set() {}, async delete() {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

function connConfig(port: number, extra: Record<string, unknown> = {}): ConnectionConfig {
  return { id: "conn-1", driver: "generic-trigger", host: "127.0.0.1", port, config: extra };
}

function endpoint(type: string): EndpointDescriptor {
  return { id: "ep-1", type, address: {}, name: "Test endpoint" };
}

async function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
}

describe("GenericTriggerDriver", () => {
  test("connect/healthCheck/isConnected always report online (no probing)", async () => {
    const driver = new GenericTriggerDriver();
    await driver.init(connConfig(9), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    expect((await driver.healthCheck()).online).toBe(true);
    await driver.destroy();
    expect(driver.isConnected()).toBe(false);
  });

  test("readState returns nothing — fire-and-forget has no state", async () => {
    const driver = new GenericTriggerDriver();
    await driver.init(connConfig(9), testContext());
    await driver.connect();
    expect(await driver.readState(endpoint("generic-trigger.tcp"))).toEqual({});
    await driver.destroy();
  });

  test("unknown command fails gracefully", async () => {
    const driver = new GenericTriggerDriver();
    await driver.init(connConfig(9), testContext());
    await driver.connect();
    const result = await driver.executeCommand(endpoint("generic-trigger.tcp"), "frobnicate", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");
    await driver.destroy();
  });

  describe("tcp", () => {
    let mock: TcpMockServer;
    beforeEach(() => {
      mock = startTcpMock();
    });
    afterEach(() => {
      mock.stop();
    });

    test("sends the payload + default CRLF delimiter, one connection per send", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      const result = await driver.executeCommand(endpoint("generic-trigger.tcp"), "send", { payload: "/go" });
      expect(result.success).toBe(true);
      await waitFor(() => mock.received().length === 1);
      expect(mock.received()).toEqual(["/go\r\n"]);

      await driver.destroy();
    });

    test("appendDelimiter:false sends the raw payload with nothing appended", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint("generic-trigger.tcp"), "send", {
        payload: "RAW",
        appendDelimiter: false,
      });
      await waitFor(() => mock.received().length === 1);
      expect(mock.received()).toEqual(["RAW"]);

      await driver.destroy();
    });

    test("a custom txDelimiter (with escape sequences) is honoured", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port, { txDelimiter: "\\n" }), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint("generic-trigger.tcp"), "send", { payload: "hi" });
      await waitFor(() => mock.received().length === 1);
      expect(mock.received()).toEqual(["hi\n"]);

      await driver.destroy();
    });

    test("two buttons on the same device fire two independent connections", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint("generic-trigger.tcp"), "send", { payload: "one" });
      await driver.executeCommand(endpoint("generic-trigger.tcp"), "send", { payload: "two" });
      await waitFor(() => mock.received().length === 2);
      expect(mock.received().sort()).toEqual(["one\r\n", "two\r\n"].sort());

      await driver.destroy();
    });

    test("an unreachable host fails the command without throwing", async () => {
      const driver = new GenericTriggerDriver();
      // Port 1 is a privileged, essentially always-closed port — a fast, reliable "nothing there".
      await driver.init(connConfig(1, { responseTimeoutMs: 300 }), testContext());
      await driver.connect();

      const result = await driver.executeCommand(endpoint("generic-trigger.tcp"), "send", { payload: "x" });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();

      await driver.destroy();
    });

    test("missing payload fails validation before touching the network", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      const result = await driver.executeCommand(endpoint("generic-trigger.tcp"), "send", {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("payload");
      await Bun.sleep(20);
      expect(mock.received()).toHaveLength(0);

      await driver.destroy();
    });
  });

  describe("udp", () => {
    let mock: UdpMockServer;
    beforeEach(async () => {
      mock = await startUdpMock();
    });
    afterEach(() => {
      mock.stop();
    });

    test("sends the raw payload as one datagram", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      const result = await driver.executeCommand(endpoint("generic-trigger.udp"), "send", { payload: "PING" });
      expect(result.success).toBe(true);
      await waitFor(() => mock.received().length === 1);
      expect(mock.received()[0]!.text).toBe("PING");

      await driver.destroy();
    });
  });

  describe("osc", () => {
    let mock: UdpMockServer;
    beforeEach(async () => {
      mock = await startUdpMock();
    });
    afterEach(() => {
      mock.stop();
    });

    test("a zero-argument message matches a hand-encoded OSC packet", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint("generic-trigger.osc"), "send", { address: "/go" });
      await waitFor(() => mock.received().length === 1);
      expect(mock.received()[0]!.bytes).toEqual(encodeOscMessage("/go"));

      await driver.destroy();
    });

    test("args are parsed and encoded exactly like driver-core's parseOscArgs", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      await driver.executeCommand(endpoint("generic-trigger.osc"), "send", {
        address: "/cue/1/level",
        args: "0.8 3 hello",
      });
      await waitFor(() => mock.received().length === 1);
      expect(mock.received()[0]!.bytes).toEqual(
        encodeOscMessage("/cue/1/level", parseOscArgs("0.8 3 hello")),
      );

      await driver.destroy();
    });

    test("an address without a leading slash fails validation before sending", async () => {
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext());
      await driver.connect();

      const result = await driver.executeCommand(endpoint("generic-trigger.osc"), "send", { address: "go" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("OSC address");
      await Bun.sleep(20);
      expect(mock.received()).toHaveLength(0);

      await driver.destroy();
    });
  });

  describe("dry-run", () => {
    test("no TCP traffic is sent", async () => {
      const mock = startTcpMock();
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext(true));
      await driver.connect();

      const result = await driver.executeCommand(endpoint("generic-trigger.tcp"), "send", { payload: "x" });
      expect(result.success).toBe(true);
      await Bun.sleep(20);
      expect(mock.received()).toHaveLength(0);

      await driver.destroy();
      mock.stop();
    });

    test("no UDP traffic is sent, but invalid params still fail", async () => {
      const mock = await startUdpMock();
      const driver = new GenericTriggerDriver();
      await driver.init(connConfig(mock.port), testContext(true));
      await driver.connect();

      const ok = await driver.executeCommand(endpoint("generic-trigger.osc"), "send", { address: "/go" });
      expect(ok.success).toBe(true);

      const bad = await driver.executeCommand(endpoint("generic-trigger.osc"), "send", { address: "nope" });
      expect(bad.success).toBe(false);

      await Bun.sleep(20);
      expect(mock.received()).toHaveLength(0);

      await driver.destroy();
      mock.stop();
    });
  });
});
