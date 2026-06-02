/**
 * DriverHost integration tests.
 *
 * These exercise the full subprocess path: DriverHost spawns the runtime
 * harness as a Bun subprocess, the harness loads the PJLink driver, and
 * commands/state/health round-trip over Bun IPC to a mock projector.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EndpointDescriptor } from "@gallery/driver-core";
import { DriverHost } from "../../src/drivers/DriverHost.ts";
import { logger } from "../../src/logger.ts";
import { memoryStore } from "../mocks/context.ts";
import { startPjlinkMock, type PjlinkMockServer } from "../mocks/mock-devices.ts";

const endpoint: EndpointDescriptor = {
  id: "dev-1",
  type: "pjlink.projector",
  address: {},
  name: "Test Projector",
};

function makeHost(port: number): DriverHost {
  return new DriverHost({
    connection: { id: "conn-1", driver: "pjlink", host: "127.0.0.1", port, config: {} },
    logger: logger.child("driver-host.test"),
    storage: memoryStore(),
    commandTimeoutMs: 5_000,
    startTimeoutMs: 10_000,
  });
}

describe("DriverHost (subprocess IPC)", () => {
  let mock: PjlinkMockServer;
  let host: DriverHost;

  beforeEach(() => {
    mock = startPjlinkMock();
  });
  afterEach(async () => {
    await host.stop();
    mock.stop();
  });

  test("executes commands and reads state across the IPC boundary", async () => {
    host = makeHost(mock.port);
    const connected = new Promise<void>((resolve) => host.on("connected", resolve));

    await host.start();
    await Promise.race([connected, Bun.sleep(3_000)]);
    expect(host.isConnected()).toBe(true);

    const on = await host.executeCommand(endpoint, "on", {});
    expect(on.success).toBe(true);
    expect(mock.state().power).toBe("1");

    const state = await host.readState(endpoint);
    expect(state).toMatchObject({ power: "on" });

    const health = await host.healthCheck();
    expect(health.online).toBe(true);
    expect(typeof health.latencyMs).toBe("number");
  }, 20_000);

  test("forwards driver state events to the host", async () => {
    host = makeHost(mock.port);
    await host.start();

    const stateEvent = new Promise<unknown>((resolve) => host.on("state", resolve));
    await host.executeCommand(endpoint, "setInput", { input: "HDMI2" });

    const event = (await Promise.race([stateEvent, Bun.sleep(3_000)])) as
      | { endpointId: string; state: Record<string, unknown> }
      | undefined;
    expect(event?.endpointId).toBe("dev-1");
    expect(event?.state).toMatchObject({ input: "32" });
  }, 20_000);
});
