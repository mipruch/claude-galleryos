/**
 * ExtronMatrixDriver tests — driver class against the in-process SIS mock.
 *
 * Covers the 6 standard driver cases plus Extron-specific behaviour:
 *   1. connect            — socket opens, isConnected() true
 *   2. commands           — setInput/setVideo/setAudio reach the device
 *   3. readState          — reflects current ties (video + audio)
 *   4. dry-run            — no traffic is sent
 *   5. unknown-command    — fails gracefully (success:false)
 *   6. disconnect         — tears down cleanly
 *   7. untie              — input 0 clears the output
 *   8. range validation   — out-of-range input/output → success:false
 *   9. password handshake — answers the `Password:` prompt
 *  10. device error       — E## surfaces as a failed command
 *  11. unsolicited tie    — front-panel change refreshes readState
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, DriverContext, EndpointDescriptor } from "@gallery/driver-core";
import ExtronMatrixDriver from "../src/index.ts";
import { startExtronMock, type ExtronMockServer } from "./mock-device.ts";

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
    driver: "extron-matrix",
    host: "127.0.0.1",
    port,
    config: { inputCount: 10, outputCount: 8, responseTimeoutMs: 1000, ...extra },
  };
}

function endpoint(output: number): EndpointDescriptor {
  return {
    id: `out-${output}`,
    type: "extron-matrix.output",
    address: { output },
    name: `Output ${output}`,
  };
}

// ── tests ─────────────────────────────────────────────────────

describe("ExtronMatrixDriver", () => {
  let mock: ExtronMockServer;

  beforeEach(() => {
    mock = startExtronMock();
  });
  afterEach(() => {
    mock.stop();
  });

  test("1. connect — socket opens, isConnected() true", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("2. commands — setInput/setVideoInput/setAudioInput reach the device", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    let result = await driver.executeCommand(endpoint(2), "setInput", { input: 5 });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ input: 5 });
    expect(mock.videoOf(2)).toBe(5);
    expect(mock.audioOf(2)).toBe(5);

    result = await driver.executeCommand(endpoint(3), "setVideoInput", { input: 7 });
    expect(result.success).toBe(true);
    expect(mock.videoOf(3)).toBe(7);
    expect(mock.audioOf(3)).toBe(0); // video only

    result = await driver.executeCommand(endpoint(3), "setAudioInput", { input: 4 });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ audioInput: 4 });
    expect(mock.audioOf(3)).toBe(4);

    await driver.destroy();
  });

  test("3. readState — reflects current ties (video + audio)", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.executeCommand(endpoint(1), "setInput", { input: 6 });
    const state = await driver.readState(endpoint(1));
    expect(state).toMatchObject({ input: 6, audioInput: 6 });

    await driver.destroy();
  });

  test("4. dry-run — no traffic is sent", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext(true));
    await driver.connect();

    const result = await driver.executeCommand(endpoint(2), "setInput", { input: 9 });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ input: 9 });
    expect(mock.received()).toHaveLength(0);

    await driver.destroy();
  });

  test("5. unknown-command — fails gracefully", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(1), "frobnicate", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("6. disconnect — tears down cleanly", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();
    await driver.disconnect();
    expect(driver.isConnected()).toBe(false);
    await driver.destroy();
  });

  test("7. untie — input 0 clears the output", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    await driver.executeCommand(endpoint(4), "setInput", { input: 8 });
    expect(mock.videoOf(4)).toBe(8);

    const result = await driver.executeCommand(endpoint(4), "setInput", { input: 0 });
    expect(result.success).toBe(true);
    expect(mock.videoOf(4)).toBe(0);

    await driver.destroy();
  });

  test("8. range validation — out-of-range input/output → success:false", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    const badInput = await driver.executeCommand(endpoint(1), "setInput", { input: 99 });
    expect(badInput.success).toBe(false);
    expect(badInput.error).toContain("invalid input");

    const badOutput = await driver.executeCommand(endpoint(99), "setInput", { input: 1 });
    expect(badOutput.success).toBe(false);
    expect(badOutput.error).toContain("invalid address");

    await driver.destroy();
  });

  test("9. password handshake — answers the prompt and then controls", async () => {
    mock.stop();
    mock = startExtronMock({ password: "s3cret" });

    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port, { password: "s3cret" }), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(2), "setInput", { input: 3 });
    expect(result.success).toBe(true);
    expect(mock.videoOf(2)).toBe(3);

    await driver.destroy();
  });

  test("10. device error — E## surfaces as a failed command", async () => {
    // Mock with only 2 inputs so input 5 is rejected with E01 on the wire,
    // but the driver is told the matrix has 10 inputs so it passes its own check.
    mock.stop();
    mock = startExtronMock({ inputs: 2, outputs: 8 });

    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port, { inputCount: 10 }), testContext());
    await driver.connect();

    const result = await driver.executeCommand(endpoint(1), "setInput", { input: 5 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("E01");

    await driver.destroy();
  });

  test("11. unsolicited tie — front-panel change refreshes readState", async () => {
    const driver = new ExtronMatrixDriver();
    await driver.init(connConfig(mock.port), testContext());
    await driver.connect();

    // Front-panel routes input 4 → output 5 without us asking.
    mock.pushTie(4, 5, "All");
    await Bun.sleep(20);

    const state = await driver.readState(endpoint(5));
    expect(state).toMatchObject({ input: 4 });

    await driver.destroy();
  });
});
