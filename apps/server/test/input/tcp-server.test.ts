/**
 * TcpInputServer tests.
 *
 *  - The pure framing/normalization helpers (`extractFrames`, `normalizeFrame`).
 *  - `receiveFrame()` is driven directly with a line (no socket): a frame is
 *    parsed, emitted as `input.tcp.received`, and handed to InputMapper.handle as
 *    a "tcp" signal; blanks are ignored; malformed frames are dropped.
 *  - One real TCP round-trip binds the server, connects a client, sends two
 *    newline-delimited frames (one split across writes), and asserts both signals
 *    arrive in order — proving the transport and per-connection buffering work.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { EventBus } from "../../src/core/EventBus.ts";
import {
  TcpInputServer,
  extractFrames,
  normalizeFrame,
  type TcpDispatcher,
} from "../../src/input/TcpInputServer.ts";
import { logger } from "../../src/logger.ts";

type Signal = { protocol: string; address: string; args?: unknown[] };

/** A dispatcher that records the signals handed to it. */
function recordingMapper() {
  const signals: Signal[] = [];
  const mapper: TcpDispatcher = {
    async handle(signal) {
      signals.push(signal);
      return [];
    },
  };
  return { mapper, signals };
}

let running: TcpInputServer | null = null;
afterEach(() => {
  running?.stop();
  running = null;
});

describe("extractFrames", () => {
  test("splits complete lines and keeps the unterminated remainder", () => {
    expect(extractFrames("a\nb\nc")).toEqual({ frames: ["a", "b"], rest: "c" });
  });

  test("a trailing newline yields no remainder", () => {
    expect(extractFrames("a\n")).toEqual({ frames: ["a"], rest: "" });
  });

  test("strips a CR before the LF (CRLF senders)", () => {
    expect(extractFrames("a\r\nb")).toEqual({ frames: ["a"], rest: "b" });
  });
});

describe("normalizeFrame", () => {
  test("accepts an object with address and args", () => {
    expect(normalizeFrame({ address: "/dim", args: [0.5] })).toEqual({ address: "/dim", args: [0.5] });
  });

  test("defaults missing args to []", () => {
    expect(normalizeFrame({ address: "/go" })).toEqual({ address: "/go", args: [] });
  });

  test("accepts a bare string as an address-only frame", () => {
    expect(normalizeFrame("/go")).toEqual({ address: "/go", args: [] });
  });

  test("rejects a missing address, non-array args, and non-objects", () => {
    expect(() => normalizeFrame({ args: [] })).toThrow();
    expect(() => normalizeFrame({ address: "/x", args: 5 })).toThrow();
    expect(() => normalizeFrame([1, 2])).toThrow();
    expect(() => normalizeFrame(42)).toThrow();
  });
});

describe("TcpInputServer.receiveFrame", () => {
  test("parses a JSON frame, emits input.tcp.received, and dispatches a tcp signal", async () => {
    const { mapper, signals } = recordingMapper();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.on("input.tcp.received", (e) => events.push(e));

    const server = new TcpInputServer({ inputMapper: mapper, eventBus: bus, logger });
    await server.receiveFrame('{"address":"/dim","args":[0.5]}', "1.2.3.4:5");

    expect(signals).toEqual([{ protocol: "tcp", address: "/dim", args: [0.5] }]);
    expect(events).toEqual([{ type: "input.tcp.received", message: '{"address":"/dim","args":[0.5]}', client: "1.2.3.4:5" }]);
  });

  test("ignores a blank/whitespace frame (keep-alive)", async () => {
    const { mapper, signals } = recordingMapper();
    const server = new TcpInputServer({ inputMapper: mapper, eventBus: new EventBus(), logger });
    await server.receiveFrame("   ");
    expect(signals).toEqual([]);
  });

  test("drops a malformed frame without dispatching", async () => {
    const { mapper, signals } = recordingMapper();
    const server = new TcpInputServer({ inputMapper: mapper, eventBus: new EventBus(), logger });
    await server.receiveFrame("not json");
    await server.receiveFrame('{"args":[]}'); // no address
    expect(signals).toEqual([]);
  });
});

describe("TcpInputServer over real TCP", () => {
  test("buffers and dispatches newline-delimited frames split across writes", async () => {
    const { mapper, signals } = recordingMapper();
    let resolveGot: () => void;
    const got = new Promise<void>((r) => (resolveGot = r));
    const wrapped: TcpDispatcher = {
      async handle(signal) {
        const out = await mapper.handle(signal);
        if (signals.length === 2) resolveGot();
        return out;
      },
    };

    const server = new TcpInputServer({ inputMapper: wrapped, eventBus: new EventBus(), logger, port: 0 });
    running = server;
    await server.start();
    expect(server.port).toBeGreaterThan(0);

    const client = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port!,
      socket: { data() {} },
    });
    // First frame whole; second frame split across two writes to exercise buffering.
    client.write('{"address":"/a","args":[1]}\n{"address":"/b"');
    client.write(',"args":[2]}\n');

    await Promise.race([
      got,
      new Promise((_r, reject) => setTimeout(() => reject(new Error("timed out")), 2000)),
    ]);
    client.end();

    expect(signals).toEqual([
      { protocol: "tcp", address: "/a", args: [1] },
      { protocol: "tcp", address: "/b", args: [2] },
    ]);
  });
});
