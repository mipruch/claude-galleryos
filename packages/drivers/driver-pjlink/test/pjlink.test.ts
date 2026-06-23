/**
 * PJLink driver tests — hermetic, against an in-process mock projector.
 *
 * Covers the behaviour the protocol (and the user) require:
 *  - a poll connects, reads status, and emits `state` with the real power/input;
 *  - `healthCheck` is cached (does no I/O, never double-polls);
 *  - any response — even an `ERR` — keeps the projector online; only a failed
 *    connection marks it offline;
 *  - auth (md5 digest) works and a bad password surfaces as an auth error;
 *  - commands (on/off/setInput/setMute) reach the device; bad input fails fast;
 *  - dry-run touches no socket.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type {
  ConnectionConfig,
  DriverContext,
  EndpointDescriptor,
  StateChangeEvent,
} from "@gallery/driver-core";
import { PjlinkDriver } from "../src/PjlinkDriver.ts";
import { startPjlinkMock, type PjlinkMockServer } from "./mock-device.ts";

const ENDPOINT: EndpointDescriptor = {
  id: "dev-1",
  type: "pjlink.projector",
  address: {},
  name: "Projector",
};

let driver: PjlinkDriver | null = null;
let mock: PjlinkMockServer | null = null;

afterEach(async () => {
  await driver?.destroy();
  mock?.stop();
  driver = null;
  mock = null;
});

function makeCtx(dryRun = false): DriverContext {
  const noop = () => {};
  return {
    logger: { debug: noop, info: noop, warn: noop, error: noop },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

function config(port: number, extra: Record<string, unknown> = {}): ConnectionConfig {
  return {
    id: "conn-1",
    driver: "pjlink",
    host: "127.0.0.1",
    port,
    config: { responseTimeoutMs: 1000, pollIntervalMs: 600_000, ...extra },
  };
}

function listen(d: PjlinkDriver) {
  const states: StateChangeEvent[] = [];
  const events: string[] = [];
  d.on("state", (e: StateChangeEvent) => states.push(e));
  d.on("connected", () => events.push("connected"));
  d.on("disconnected", () => events.push("disconnected"));
  return { states, events };
}

describe("PjlinkDriver", () => {
  test("poll connects, marks online, and emits the projector's state", async () => {
    mock = startPjlinkMock({ power: "1" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port), makeCtx());
    const { states, events } = listen(driver);

    await driver.connect();
    await driver.subscribeToEndpoint(ENDPOINT);

    expect(driver.isConnected()).toBe(true);
    expect(events).toContain("connected");

    const last = states.at(-1)!;
    expect(last.endpointId).toBe("dev-1");
    expect(last.source).toBe("poll");
    expect(last.state.power).toBe("on");
    expect(last.state.input).toBe("31");
    expect(last.state.errors).toEqual({
      fan: "ok", lamp: "ok", temperature: "ok", cover: "ok", filter: "ok", other: "ok",
    });
  });

  test("healthCheck is cached — it does no I/O and never double-polls", async () => {
    mock = startPjlinkMock({ power: "1" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port), makeCtx());
    await driver.connect();
    await driver.subscribeToEndpoint(ENDPOINT);

    const before = mock.connections();
    const health = await driver.healthCheck();

    expect(health.online).toBe(true);
    expect(mock.connections()).toBe(before); // no new socket opened
  });

  test("an ERR response keeps the projector online (offline only on connect failure)", async () => {
    // Powered off → the projector answers ERR3 to INPT query.
    mock = startPjlinkMock({ power: "0" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port), makeCtx());
    const { states, events } = listen(driver);

    await driver.connect();
    await driver.subscribeToEndpoint(ENDPOINT);

    expect(driver.isConnected()).toBe(true);
    expect(events).toContain("connected");
    expect(events).not.toContain("disconnected");

    const last = states.at(-1)!;
    expect(last.state.power).toBe("off");
    // ERR'd / unpolled fields are omitted (Redis keeps the last known value).
    expect(last.state.input).toBeUndefined();
  });

  test("a failed connection marks the projector offline", async () => {
    mock = startPjlinkMock({ power: "1" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port), makeCtx());
    const { events } = listen(driver);

    await driver.connect();
    await driver.subscribeToEndpoint(ENDPOINT);
    expect(driver.isConnected()).toBe(true);

    mock.stop(); // projector goes away
    await expect(driver.readState(ENDPOINT)).rejects.toThrow();

    expect(driver.isConnected()).toBe(false);
    expect(events).toContain("disconnected");
  });

  test("executeCommand powers the projector on and off", async () => {
    mock = startPjlinkMock({ power: "0" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port), makeCtx());

    const on = await driver.executeCommand(ENDPOINT, "on", {});
    expect(on.success).toBe(true);
    expect(on.state?.power).toBe("on");
    expect(mock.power()).toBe("1");

    const off = await driver.executeCommand(ENDPOINT, "off", {});
    expect(off.success).toBe(true);
    expect(mock.power()).toBe("0");
  });

  test("setInput maps friendly names and setMute toggles AV mute", async () => {
    mock = startPjlinkMock({ power: "1" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port), makeCtx());

    const input = await driver.executeCommand(ENDPOINT, "setInput", { input: "RGB1" });
    expect(input.success).toBe(true);
    expect(input.state?.input).toBe("11");
    expect(mock.input()).toBe("11");

    const mute = await driver.executeCommand(ENDPOINT, "setMute", { muted: true });
    expect(mute.success).toBe(true);
    expect(mute.state?.muted).toBe(true);
    expect(mock.avmt()).toBe("31");
  });

  test("an invalid input fails fast without touching the network", async () => {
    mock = startPjlinkMock({ power: "1" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port), makeCtx());

    const before = mock.connections();
    const result = await driver.executeCommand(ENDPOINT, "setInput", { input: "BOGUS" });

    expect(result.success).toBe(false);
    expect(mock.connections()).toBe(before);
  });

  test("authentication: the md5 digest is sent and a correct password connects", async () => {
    mock = startPjlinkMock({ password: "secret", seed: "abcdef12", power: "1" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port, { password: "secret" }), makeCtx());

    await driver.connect();
    await driver.subscribeToEndpoint(ENDPOINT);

    expect(driver.isConnected()).toBe(true);
    const digest = new Bun.CryptoHasher("md5").update("abcdef12secret").digest("hex");
    expect(mock.received().some((line) => line.startsWith(digest))).toBe(true);
  });

  test("authentication: a wrong password surfaces as an auth error and offline", async () => {
    mock = startPjlinkMock({ password: "secret", power: "1" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port, { password: "wrong" }), makeCtx());

    await driver.connect();
    expect(driver.isConnected()).toBe(false);

    const result = await driver.executeCommand(ENDPOINT, "on", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("authentication");
  });

  test("dry-run never opens a socket", async () => {
    mock = startPjlinkMock({ power: "0" });
    driver = new PjlinkDriver();
    await driver.init(config(mock.port), makeCtx(true));

    const on = await driver.executeCommand(ENDPOINT, "on", {});
    expect(on.success).toBe(true);
    expect(on.state?.power).toBe("on");

    const state = await driver.readState(ENDPOINT);
    expect(state.power).toBe("on");
    expect(mock.connections()).toBe(0);
  });
});
