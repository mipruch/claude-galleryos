/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DRIVER TEMPLATE — test/mock-device.ts                                    │
 * │                                                                           │
 * │  An in-process fake of the physical device, built on Bun.listen. Tests    │
 * │  point the driver at `mock.port` on 127.0.0.1 — no real hardware, fully   │
 * │  deterministic. Copy this and teach it your protocol's framing + verbs.   │
 * │                                                                           │
 * │  Speaks the toy ASCII line protocol described in TemplateDriver.ts.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { Socket, TCPSocketListener } from "bun";

export interface TemplateMockServer {
  /** Ephemeral port the mock is listening on (pass to the driver as `port`). */
  port: number;
  /** Stop the listener (call in afterEach). */
  stop: () => void;
  /** Current device state, for assertions. */
  state: () => { power: boolean; level: number };
}

interface Conn {
  buf: string;
}

/** Start a mock template device. Returns its port, a stopper, and a state peek. */
export function startTemplateMock(): TemplateMockServer {
  // The device's authoritative state. The driver mutates it via commands.
  const state = { power: false, level: 0 };
  const conns = new WeakMap<Socket<Conn>, Conn>();

  const server: TCPSocketListener<Conn> = Bun.listen<Conn>({
    hostname: "127.0.0.1",
    port: 0, // 0 → OS picks a free port; read it back from server.port
    socket: {
      open(socket) {
        conns.set(socket, { buf: "" });
      },
      data(socket, data) {
        const conn = conns.get(socket);
        if (!conn) return;
        // Accumulate bytes and split on the protocol delimiter ("\n" here).
        conn.buf += Buffer.from(data).toString("utf8");
        let idx: number;
        while ((idx = conn.buf.indexOf("\n")) !== -1) {
          const line = conn.buf.slice(0, idx);
          conn.buf = conn.buf.slice(idx + 1);
          socket.write(handle(line, state) + "\n");
        }
      },
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(),
    state: () => ({ ...state }),
  };
}

/** Reply to one request line, mutating device state as needed. */
function handle(line: string, state: { power: boolean; level: number }): string {
  const c = line.trim();
  if (c === "PING") return "PONG";
  if (c === "PWR ?") return `PWR=${state.power ? 1 : 0}`;
  if (c === "PWR 1") return (state.power = true), "OK";
  if (c === "PWR 0") return (state.power = false), "OK";
  if (c === "LVL ?") return `LVL=${state.level}`;
  if (c.startsWith("LVL ")) {
    const n = Number(c.slice(4));
    if (Number.isInteger(n) && n >= 0 && n <= 100) {
      state.level = n;
      if (n > 0) state.power = true;
      return "OK";
    }
  }
  return "ERR";
}
