/**
 * DaliLunatoneDriver unit tests — driver class directly against a mock DALI-2
 * IoT gateway (HTTP). Verifies ControlData encoding, state read-back, discovery,
 * and dry-run.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, EndpointDescriptor } from "@gallery/driver-core";
import DaliLunatoneDriver from "@gallery/driver-dali-lunatone";
import { startDaliIotMock, type DaliMockServer } from "../mocks/mock-dali-iot.ts";
import { testContext } from "../mocks/context.ts";

const endpoint: EndpointDescriptor = {
  id: "dev-1",
  type: "dali.fixture",
  address: { deviceId: 1, daliAddress: 0 },
  name: "Fixture 1",
};

function connConfig(
  mock: DaliMockServer,
  config: Record<string, unknown> = {},
): ConnectionConfig {
  return { id: "conn-1", driver: "dali-lunatone", host: mock.host, port: mock.port, config };
}

describe("DaliLunatoneDriver", () => {
  let mock: DaliMockServer;

  beforeEach(() => {
    mock = startDaliIotMock();
  });
  afterEach(() => {
    mock.stop();
  });

  test("connects and reports online", async () => {
    const driver = new DaliLunatoneDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock), ctx);
    await driver.connect();
    expect(driver.isConnected()).toBe(true);
    await driver.destroy();
  });

  test("on/off translate to switchable ControlData", async () => {
    const driver = new DaliLunatoneDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock), ctx);

    const on = await driver.executeCommand(endpoint, "on", {});
    expect(on.success).toBe(true);
    expect(mock.state()[1]!.power).toBe(true);

    const off = await driver.executeCommand(endpoint, "off", {});
    expect(off.success).toBe(true);
    expect(mock.state()[1]!.power).toBe(false);

    await driver.destroy();
  });

  test("setBrightness maps 0..1 to a 0..100 dim percent", async () => {
    const driver = new DaliLunatoneDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock), ctx);

    const res = await driver.executeCommand(endpoint, "setBrightness", { level: 0.5 });
    expect(res.success).toBe(true);
    expect(res.state).toMatchObject({ brightness: 0.5, power: true });
    expect(mock.state()[1]!.dim).toBe(50);

    await driver.destroy();
  });

  test("recall sends a scene number", async () => {
    const driver = new DaliLunatoneDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock), ctx);

    const res = await driver.executeCommand(endpoint, "recall", { scene: 4 });
    expect(res.success).toBe(true);
    expect(mock.state()[1]!.lastScene).toBe(4);

    await driver.destroy();
  });

  test("readState reflects device features", async () => {
    const driver = new DaliLunatoneDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock), ctx);

    await driver.executeCommand(endpoint, "setBrightness", { level: 0.8 });
    const state = await driver.readState(endpoint);
    expect(state).toMatchObject({ power: true, brightness: 0.8 });

    await driver.destroy();
  });

  test("discoverEndpoints lists registered fixtures", async () => {
    const driver = new DaliLunatoneDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock), ctx);

    const found = await driver.discoverEndpoints();
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      type: "dali.fixture",
      address: { deviceId: 1, daliAddress: 0 },
    });

    await driver.destroy();
  });

  test("unknown command fails gracefully", async () => {
    const driver = new DaliLunatoneDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock), ctx);

    const result = await driver.executeCommand(endpoint, "frobnicate", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown command");

    await driver.destroy();
  });

  test("dry-run does not touch the device", async () => {
    const driver = new DaliLunatoneDriver();
    const { ctx } = testContext(true);
    await driver.init(connConfig(mock), ctx);

    const result = await driver.executeCommand(endpoint, "on", {});
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ power: true });
    // The real device (id 1) was never switched on.
    expect(mock.state()[1]!.power).toBe(false);

    await driver.destroy();
  });
});
