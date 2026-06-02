/**
 * TcpGenericDriver unit tests against a newline-framed echo server.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionConfig, EndpointDescriptor } from "@gallery/driver-core";
import TcpGenericDriver from "@gallery/driver-tcp-generic";
import { startEchoMock, type MockServer } from "../mocks/mock-devices.ts";
import { testContext } from "../mocks/context.ts";

const endpoint: EndpointDescriptor = {
  id: "dev-1",
  type: "tcp-generic.endpoint",
  address: { label: "relay" },
  name: "Relay",
};

function connConfig(port: number, config: Record<string, unknown> = {}): ConnectionConfig {
  return {
    id: "conn-1",
    driver: "tcp-generic",
    host: "127.0.0.1",
    port,
    config: { txDelimiter: "\\n", rxDelimiter: "\\n", ...config },
  };
}

describe("TcpGenericDriver", () => {
  let mock: MockServer;

  beforeEach(() => {
    mock = startEchoMock();
  });
  afterEach(() => {
    mock.stop();
  });

  test("send with expectResponse returns the response frame", async () => {
    const driver = new TcpGenericDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port), ctx);

    const result = await driver.executeCommand(endpoint, "send", {
      payload: "OPEN",
      expectResponse: true,
    });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ lastResponse: "ECHO:OPEN" });

    await driver.destroy();
  });

  test("fire-and-forget send succeeds without waiting", async () => {
    const driver = new TcpGenericDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port), ctx);

    const result = await driver.executeCommand(endpoint, "send", { payload: "PING" });
    expect(result.success).toBe(true);
    expect(result.state).toBeUndefined();

    await driver.destroy();
  });

  test("persistent mode reuses the connection across commands", async () => {
    const driver = new TcpGenericDriver();
    const { ctx } = testContext();
    await driver.init(connConfig(mock.port, { persistent: true }), ctx);
    await driver.connect();

    const a = await driver.executeCommand(endpoint, "send", { payload: "A", expectResponse: true });
    const b = await driver.executeCommand(endpoint, "send", { payload: "B", expectResponse: true });
    expect(a.state).toMatchObject({ lastResponse: "ECHO:A" });
    expect(b.state).toMatchObject({ lastResponse: "ECHO:B" });

    await driver.destroy();
  });

  test("dry-run does not send", async () => {
    const driver = new TcpGenericDriver();
    const { ctx } = testContext(true);
    await driver.init(connConfig(mock.port), ctx);

    const result = await driver.executeCommand(endpoint, "send", {
      payload: "X",
      expectResponse: true,
    });
    expect(result.success).toBe(true);
    expect(result.state).toBeUndefined();

    await driver.destroy();
  });
});
