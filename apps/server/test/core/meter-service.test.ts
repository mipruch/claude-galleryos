/**
 * MeterService unit tests — the ref-counted fan-out that keeps exactly one BSS
 * subscription per meter while forwarding readings only to watching clients.
 */

import { describe, expect, it } from "bun:test";
import type { MeterUpdate } from "@gallery/driver-core";
import { EventBus } from "../../src/core/EventBus.ts";
import { MeterService, type MeterClient, type MeterDeviceSource } from "../../src/core/MeterService.ts";
import { logger } from "../../src/logger.ts";

const CONN = "conn-1";
const DEVICE = "widget-1";

/** A meter widget with two meters on objects 100 and 101. */
function makeSource(): MeterDeviceSource & {
  subscribed: Record<string, unknown>[];
  unsubscribed: Record<string, unknown>[];
} {
  const subscribed: Record<string, unknown>[] = [];
  const unsubscribed: Record<string, unknown>[] = [];
  return {
    subscribed,
    unsubscribed,
    async getDeviceRecord(deviceId: string) {
      expect(deviceId).toBe(DEVICE);
      return {
        connectionId: CONN,
        endpointType: "bss-soundweb.meter-widget",
        address: {
          node: 7678,
          virtualDevice: 3,
          minDb: -80,
          maxDb: 40,
          meters: [
            { label: "Mic 1", object: 100, param: 0 },
            { label: "Mic 2", object: 101, param: 0 },
          ],
        },
      };
    },
    meterSubscribe(_connectionId, address) {
      subscribed.push(address);
    },
    meterUnsubscribe(_connectionId, address) {
      unsubscribed.push(address);
    },
  };
}

/** A fake browser socket that records the messages it receives. */
function makeClient(): MeterClient & { messages: unknown[] } {
  const messages: unknown[] = [];
  return {
    messages,
    send(data: string) {
      messages.push(JSON.parse(data));
    },
  };
}

function update(object: number, level: number): MeterUpdate {
  return {
    address: { node: 7678, virtualDevice: 3, object, param: 0 },
    value: level * 1200000 - 800000, // inverse of the driver's level mapping
    level,
  };
}

describe("MeterService", () => {
  it("subscribes once per meter and fans readings out to every watcher", async () => {
    const source = makeSource();
    const service = new MeterService({ devices: source, eventBus: new EventBus(), logger });
    const a = makeClient();
    const b = makeClient();

    await service.subscribe(a, DEVICE);
    // First watcher → one BSS subscription per meter (2 meters).
    expect(source.subscribed.length).toBe(2);

    await service.subscribe(b, DEVICE);
    // Second watcher of the same meters → no extra BSS subscriptions.
    expect(source.subscribed.length).toBe(2);

    service.handleMeterUpdate(CONN, update(100, 0.5));
    // Both clients get the reading for meter object 100.
    expect(a.messages).toHaveLength(1);
    expect(b.messages).toHaveLength(1);
    expect(a.messages[0]).toMatchObject({
      event: "meter:update",
      data: { object: 100, level: 0.5 },
    });
  });

  it("unsubscribes the meter only when the last watcher leaves", async () => {
    const source = makeSource();
    const service = new MeterService({ devices: source, eventBus: new EventBus(), logger });
    const a = makeClient();
    const b = makeClient();

    await service.subscribe(a, DEVICE);
    await service.subscribe(b, DEVICE);

    await service.unsubscribe(a, DEVICE);
    expect(source.unsubscribed.length).toBe(0); // b still watching

    await service.unsubscribe(b, DEVICE);
    expect(source.unsubscribed.length).toBe(2); // both meters released
  });

  it("releases everything a client watched when it disconnects", async () => {
    const source = makeSource();
    const service = new MeterService({ devices: source, eventBus: new EventBus(), logger });
    const a = makeClient();

    await service.subscribe(a, DEVICE);
    service.disconnect(a);
    expect(source.unsubscribed.length).toBe(2);

    // A reading after disconnect reaches nobody (and doesn't throw).
    service.handleMeterUpdate(CONN, update(100, 0.9));
    expect(a.messages).toHaveLength(0);
  });

  it("re-arms active meters when the connection reconnects", async () => {
    const source = makeSource();
    const bus = new EventBus();
    const service = new MeterService({ devices: source, eventBus: bus, logger });
    const a = makeClient();

    await service.subscribe(a, DEVICE);
    expect(source.subscribed.length).toBe(2);

    // A subprocess restart wipes the driver's subscriptions; the connection
    // re-connects and the service must re-subscribe everything still watched.
    bus.emit({ type: "connection.connected", connectionId: CONN });
    expect(source.subscribed.length).toBe(4);
  });
});
