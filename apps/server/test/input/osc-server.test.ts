/**
 * OscServer tests.
 *
 *  - `receive()` is driven directly with raw bytes (no socket): a message is
 *    decoded, emitted as `input.osc.received`, and handed to InputMapper.handle
 *    as an "osc" signal; bundles fan out; malformed packets are dropped.
 *  - One real UDP round-trip binds the server, sends a datagram from a second
 *    socket, and asserts the signal arrives — proving the transport is wired.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { EventBus } from "../../src/core/EventBus.ts";
import { OscServer, type OscDispatcher } from "../../src/input/OscServer.ts";
import { logger } from "../../src/logger.ts";
import { encodeOscBundle, encodeOscMessage, oscString } from "./osc-encode.ts";

type Signal = { protocol: string; address: string; args?: unknown[] };

/** A dispatcher that records the signals handed to it. */
function recordingMapper() {
  const signals: Signal[] = [];
  const mapper: OscDispatcher = {
    async handle(signal) {
      signals.push(signal);
      return [];
    },
  };
  return { mapper, signals };
}

let running: OscServer | null = null;
afterEach(() => {
  running?.stop();
  running = null;
});

describe("OscServer.receive", () => {
  test("decodes a message, emits input.osc.received, and dispatches an osc signal", async () => {
    const { mapper, signals } = recordingMapper();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.on("input.osc.received", (e) => events.push(e));

    const server = new OscServer({ inputMapper: mapper, eventBus: bus, logger });
    await server.receive(encodeOscMessage("/dim", [{ tag: "f", value: 0.5 }]));

    expect(signals).toHaveLength(1);
    expect(signals[0]!.protocol).toBe("osc");
    expect(signals[0]!.address).toBe("/dim");
    expect(signals[0]!.args![0]).toBeCloseTo(0.5, 6);
    expect(events).toHaveLength(1);
  });

  test("fans out every message in a bundle", async () => {
    const { mapper, signals } = recordingMapper();
    const server = new OscServer({ inputMapper: mapper, eventBus: new EventBus(), logger });
    await server.receive(encodeOscBundle([encodeOscMessage("/a"), encodeOscMessage("/b")]));
    expect(signals.map((s) => s.address)).toEqual(["/a", "/b"]);
  });

  test("drops a malformed packet without dispatching", async () => {
    const { mapper, signals } = recordingMapper();
    const server = new OscServer({ inputMapper: mapper, eventBus: new EventBus(), logger });
    await server.receive(oscString("not-osc")); // doesn't start with '/' or '#'
    expect(signals).toEqual([]);
  });

  test("a throwing dispatcher does not break the loop for later messages", async () => {
    const seen: string[] = [];
    const mapper: OscDispatcher = {
      async handle(signal) {
        seen.push(signal.address);
        if (signal.address === "/a") throw new Error("boom");
        return [];
      },
    };
    const server = new OscServer({ inputMapper: mapper, eventBus: new EventBus(), logger });
    await server.receive(encodeOscBundle([encodeOscMessage("/a"), encodeOscMessage("/b")]));
    expect(seen).toEqual(["/a", "/b"]);
  });
});

describe("OscServer over real UDP", () => {
  test("binds a port and dispatches a datagram sent to it", async () => {
    const { mapper, signals } = recordingMapper();
    let resolveGot: () => void;
    const got = new Promise<void>((r) => (resolveGot = r));
    const wrapped: OscDispatcher = {
      async handle(signal) {
        const out = await mapper.handle(signal);
        resolveGot();
        return out;
      },
    };

    const server = new OscServer({ inputMapper: wrapped, eventBus: new EventBus(), logger, port: 0 });
    running = server;
    await server.start();
    expect(server.port).toBeGreaterThan(0);

    const sender = await Bun.udpSocket({});
    sender.send(encodeOscMessage("/ping", [{ tag: "i", value: 7 }]), server.port!, "127.0.0.1");

    await Promise.race([
      got,
      new Promise((_r, reject) => setTimeout(() => reject(new Error("timed out")), 2000)),
    ]);
    sender.close();

    expect(signals).toEqual([{ protocol: "osc", address: "/ping", args: [7] }]);
  });
});
