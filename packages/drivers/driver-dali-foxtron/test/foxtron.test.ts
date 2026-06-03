/**
 * DaliFoxtronDriver tests — driver class against the in-process mock gateway.
 *
 * Standard 6 cases + Foxtron-specific:
 *   1. connect          — TCP opens, isConnected() true
 *   2. commands         — on/off/setBrightness/recall reach the device
 *   3. readState        — Query Actual Level (Type 11/13) returns brightness
 *   4. dry-run          — no TCP frames sent
 *   5. unknown-command  — fails gracefully
 *   6. disconnect       — tears down cleanly
 *   7. healthCheck      — queries DALI bus status via Type 6/7
 *   8. setBrightness 0  — DAPC 0 means off
 *   9. recall scene     — correct DALI scene command sent
 *  10. reconnect        — driver reconnects and re-emits connected
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, DriverContext, EndpointDescriptor } from "@gallery/driver-core";
import DaliFoxtronDriver from "../src/index.ts";
import { DaliAddr, MsgType } from "../src/foxtron-codec.ts";
import { startFoxtronMock, type FoxtronMockServer } from "./mock-device.ts";

/** Build a group / broadcast endpoint descriptor. */
function groupEp(group: number): EndpointDescriptor {
  return { id: `g-${group}`, type: "dali-foxtron.fixture", address: { addressMode: "group", group }, name: `Group ${group}` };
}
function broadcastEp(): EndpointDescriptor {
  return { id: "bc", type: "dali-foxtron.fixture", address: { addressMode: "broadcast" }, name: "All fixtures" };
}

function testContext(dryRun = false): DriverContext {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    storage: { async get() { return undefined; }, async set() {}, async delete() {} },
    dryRun,
    signal: new AbortController().signal,
  };
}

function connConfig(port: number): ConnectionConfig {
  return { id: "conn-1", driver: "dali-foxtron", host: "127.0.0.1", port, config: { responseTimeoutMs: 1000 } };
}

function ep(daliAddress: number): EndpointDescriptor {
  return { id: `dali-${daliAddress}`, type: "dali-foxtron.fixture", address: { daliAddress }, name: `Fixture ${daliAddress}` };
}

async function waitFor(pred: () => boolean, ms = 500): Promise<void> {
  const t = Date.now();
  while (!pred()) {
    if (Date.now() - t > ms) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
}

describe("DaliFoxtronDriver", () => {
  let mock: FoxtronMockServer;

  beforeEach(() => { mock = startFoxtronMock(); });
  afterEach(() => { mock.stop(); });

  test("1. connect — TCP opens, isConnected() true", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();
    expect(d.isConnected()).toBe(true);
    await d.destroy();
  });

  test("2. commands — on/off/setBrightness reach the device", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    // on → Recall Max Level
    let r = await d.executeCommand(ep(5), "on", {});
    expect(r.success).toBe(true);
    expect(r.state).toMatchObject({ on: true, brightness: 1 });
    await waitFor(() => mock.getLevel(5) === 254);
    expect(mock.getLevel(5)).toBe(254);

    // off → Off
    r = await d.executeCommand(ep(5), "off", {});
    expect(r.success).toBe(true);
    expect(r.state).toMatchObject({ on: false, brightness: 0 });
    await waitFor(() => mock.getLevel(5) === 0);
    expect(mock.getLevel(5)).toBe(0);

    // setBrightness → DAPC
    r = await d.executeCommand(ep(5), "setBrightness", { level: 0.5 });
    expect(r.success).toBe(true);
    expect(r.state).toMatchObject({ on: true });
    await waitFor(() => mock.getLevel(5) > 0);
    expect(mock.getLevel(5)).toBe(Math.round(0.5 * 254));

    await d.destroy();
  });

  test("3. readState — Query Actual Level returns brightness", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    mock.setLevel(10, 127);
    const state = await d.readState(ep(10));
    expect(typeof state.on).toBe("boolean");
    expect(state.on).toBe(true);
    expect((state.brightness as number)).toBeCloseTo(127 / 254, 2);

    await d.destroy();
  });

  test("3b. readState — level=0 means off", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    mock.setLevel(3, 0);
    const state = await d.readState(ep(3));
    expect(state.on).toBe(false);
    expect(state.brightness).toBe(0);

    await d.destroy();
  });

  test("4. dry-run — no TCP frames sent", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext(true));
    await d.connect();

    const r = await d.executeCommand(ep(1), "on", {});
    expect(r.success).toBe(true);
    expect(r.state).toMatchObject({ on: true, brightness: 1 });
    expect(mock.received).toHaveLength(0); // nothing sent
    expect(mock.getLevel(1)).toBe(0); // device untouched

    await d.destroy();
  });

  test("5. unknown-command — fails gracefully", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    const r = await d.executeCommand(ep(0), "flicker", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("unknown command");

    await d.destroy();
  });

  test("6. disconnect — tears down cleanly", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
    await d.destroy();
  });

  test("7. healthCheck — queries DALI bus status", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    // Bus OK (status=0).
    let h = await d.healthCheck();
    expect(h.online).toBe(true);

    // Simulate power loss.
    mock.setBusStatus(1);
    h = await d.healthCheck();
    expect(h.online).toBe(false);
    expect(h.details).toContain("1");

    await d.destroy();
  });

  test("8. setBrightness 0 → DAPC 0 (off)", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    mock.setLevel(2, 200);
    const r = await d.executeCommand(ep(2), "setBrightness", { level: 0 });
    expect(r.success).toBe(true);
    expect(r.state).toMatchObject({ on: false, brightness: 0 });
    await waitFor(() => mock.getLevel(2) === 0);
    expect(mock.getLevel(2)).toBe(0);

    await d.destroy();
  });

  test("9. recall scene — sends correct DALI scene command", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    const r = await d.executeCommand(ep(4), "recall", { scene: 3 });
    expect(r.success).toBe(true);
    await waitFor(() => mock.received.some((f) => f[0] === MsgType.SEND));

    // The DALI command byte should be RECALL_SCENE_0 + 3 = 0x13
    const sentFrames = mock.received.filter((f) => f[0] === MsgType.SEND);
    const lastSend = sentFrames.at(-1)!;
    // Frame: [type=1, priority, bitLen=16, addrByte, cmdByte]
    // addr byte for unicast addr 4 cmd: 4*2+1 = 9
    expect(lastSend[3]).toBe(DaliAddr.unicastCmd(4));
    expect(lastSend[4]).toBe(0x13); // RECALL_SCENE_0 + 3

    await d.destroy();
  });

  test("10. readState — Type 11 is used (Type 13 reply correlation)", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    mock.setLevel(7, 100);
    await d.readState(ep(7));

    // The received frames should include a Type 11 (0x0B) for the query.
    const hasType11 = mock.received.some((f) => f[0] === MsgType.SEND_ORIG);
    expect(hasType11).toBe(true);
    // And the DALI cmd byte in the query should be 0xA0 (Query Actual Level).
    const type11 = mock.received.find((f) => f[0] === MsgType.SEND_ORIG)!;
    expect(type11[4]).toBe(0xA0);

    await d.destroy();
  });

  // ── group control ─────────────────────────────────────────

  test("11. group setBrightness — uses group DAPC byte and sets group level", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    const r = await d.executeCommand(groupEp(2), "setBrightness", { level: 1 });
    expect(r.success).toBe(true);
    expect(r.state).toMatchObject({ on: true, brightness: 1 });

    await waitFor(() => mock.getGroupLevel(2) === 254);
    expect(mock.getGroupLevel(2)).toBe(254);

    // Frame: [type=1, priority, bitLen=16, addrByte, level]; group 2 DAPC = 0x84
    const send = mock.received.find((f) => f[0] === MsgType.SEND)!;
    expect(send[3]).toBe(DaliAddr.groupDapc(2)); // 0x84
    expect(send[4]).toBe(254);
    // Individual address 2 must be untouched (group ≠ individual).
    expect(mock.getLevel(2)).toBe(0);

    await d.destroy();
  });

  test("12. group on/off — use group command byte (g*2+0x81)", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    await d.executeCommand(groupEp(3), "on", {});
    await waitFor(() => mock.getGroupLevel(3) === 254);
    let send = mock.received.at(-1)!;
    expect(send[3]).toBe(DaliAddr.groupCmd(3)); // 0x87
    expect(send[4]).toBe(0x05); // RECALL_MAX

    await d.executeCommand(groupEp(3), "off", {});
    await waitFor(() => mock.getGroupLevel(3) === 0);
    send = mock.received.at(-1)!;
    expect(send[3]).toBe(DaliAddr.groupCmd(3));
    expect(send[4]).toBe(0x00); // OFF

    await d.destroy();
  });

  test("13. group readState — returns last optimistic state (no bus query)", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    await d.executeCommand(groupEp(4), "setBrightness", { level: 0.5 });
    const beforeCount = mock.received.length;

    const state = await d.readState(groupEp(4));
    expect(state).toMatchObject({ on: true });
    expect(state.brightness).toBeCloseTo(0.5, 1);
    // No extra frame sent — group state can't be queried, so it's read from cache.
    expect(mock.received.length).toBe(beforeCount);

    await d.destroy();
  });

  // ── broadcast control ─────────────────────────────────────

  test("14. broadcast off — uses 0xFF and clears all fixtures", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    // Pre-set a couple of fixtures.
    mock.setLevel(0, 254);
    mock.setLevel(20, 100);

    await d.executeCommand(broadcastEp(), "off", {});
    await waitFor(() => mock.getLevel(0) === 0 && mock.getLevel(20) === 0);
    expect(mock.getLevel(0)).toBe(0);
    expect(mock.getLevel(20)).toBe(0);

    const send = mock.received.at(-1)!;
    expect(send[3]).toBe(DaliAddr.broadcastCmd); // 0xFF
    expect(send[4]).toBe(0x00); // OFF

    await d.destroy();
  });

  test("15. broadcast setBrightness — uses 0xFE and sets all fixtures", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    await d.executeCommand(broadcastEp(), "setBrightness", { level: 1 });
    await waitFor(() => mock.getLevel(0) === 254 && mock.getLevel(63) === 254);
    expect(mock.getLevel(0)).toBe(254);
    expect(mock.getLevel(63)).toBe(254);

    const send = mock.received.at(-1)!;
    expect(send[3]).toBe(DaliAddr.broadcastDapc); // 0xFE

    await d.destroy();
  });

  // ── address validation + backward compat ──────────────────

  test("16. legacy address (no addressMode) still works", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    // Old-style endpoint: just { daliAddress: 8 }
    const legacy: EndpointDescriptor = {
      id: "legacy", type: "dali-foxtron.fixture", address: { daliAddress: 8 }, name: "Legacy",
    };
    const r = await d.executeCommand(legacy, "on", {});
    expect(r.success).toBe(true);
    await waitFor(() => mock.getLevel(8) === 254);
    expect(mock.getLevel(8)).toBe(254);

    await d.destroy();
  });

  test("17. invalid group → command fails gracefully", async () => {
    const d = new DaliFoxtronDriver();
    await d.init(connConfig(mock.port), testContext());
    await d.connect();

    const badGroup: EndpointDescriptor = {
      id: "bad", type: "dali-foxtron.fixture", address: { addressMode: "group", group: 99 }, name: "Bad",
    };
    const r = await d.executeCommand(badGroup, "on", {});
    expect(r.success).toBe(false);
    expect(r.error).toContain("group");

    await d.destroy();
  });
});
