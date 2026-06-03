/**
 * In-process mock Foxtron DALI gateway for tests.
 *
 * Runs a real Bun.listen TCP server that speaks the ASCII framed protocol
 * exactly as documented. Tests connect the driver to mock.port on 127.0.0.1.
 *
 * Behaviour:
 *   - Type 1  (send DALI):         applies the DALI command to fixture state;
 *                                  responds with Type 3/4 as confirmation.
 *   - Type 11 (send DALI + orig):  same, but responds with Type 13/14 so the
 *                                  driver can correlate the reply.
 *   - Type 6  (config query):      responds with Type 7; item 3 returns current
 *                                  busStatus (0=OK, 1=power lost, etc.)
 *
 * Fixture state is per DALI address (0–63): DAPC level 0–254.
 * 0 = off, 1–254 = on at that level.
 */

import type { TCPSocketListener } from "bun";
import {
  DaliAddr,
  DaliCmd,
  FrameDecoder,
  MsgType,
  encodeFrame,
} from "../src/foxtron-codec.ts";

export interface FoxtronMockOptions {
  /** DALI bus status returned by Type 6 item-3 query. 0=OK, 1=power lost. Default 0. */
  busStatus?: number;
}

export interface FoxtronMockServer {
  port: number;
  stop: () => void;
  /** Get current DAPC level for a DALI address (0=off, 1–254=level). */
  getLevel: (addr: number) => number;
  /** Get the last DAPC level applied to a DALI group (0–15). */
  getGroupLevel: (group: number) => number;
  /** Directly set a DALI address's level (simulates external change). */
  setLevel: (addr: number, dapc: number) => void;
  /** Force bus status for next Type-6 query (0=OK, 1=power lost). */
  setBusStatus: (status: number) => void;
  /** All Type-1/11 command bytes received, in order. */
  received: number[][];
}

interface Conn {
  decoder: FrameDecoder;
}

export function startFoxtronMock(opts: FoxtronMockOptions = {}): FoxtronMockServer {
  const levels = new Map<number, number>();       // daliAddr 0-63 → DAPC 0-254
  const groupLevels = new Map<number, number>();   // group 0-15 → last DAPC applied
  let busStatus = opts.busStatus ?? 0;
  const received: number[][] = [];

  const getLevel = (addr: number) => levels.get(addr) ?? 0;
  const getGroupLevel = (g: number) => groupLevels.get(g) ?? 0;

  /** Classify a DALI address byte into the affected target(s). */
  function resolveTarget(addrByte: number):
    | { kind: "individual"; addr: number }
    | { kind: "group"; group: number }
    | { kind: "broadcast" } {
    if (addrByte === DaliAddr.broadcastDapc || addrByte === DaliAddr.broadcastCmd) {
      return { kind: "broadcast" };
    }
    if (addrByte >= 0x80) {
      // Group: even = DAPC (g*2+0x80), odd = command (g*2+0x81)
      const group = (addrByte % 2 === 0 ? addrByte - 0x80 : addrByte - 0x81) >> 1;
      return { kind: "group", group };
    }
    // Individual: even = DAPC (addr*2), odd = command (addr*2+1)
    const addr = (addrByte % 2 === 0 ? addrByte : addrByte - 1) >> 1;
    return { kind: "individual", addr };
  }

  /** Apply a level (DAPC value) to whatever target an address byte points at. */
  function applyLevel(addrByte: number, value: number): void {
    const t = resolveTarget(addrByte);
    if (t.kind === "broadcast") for (let i = 0; i < 64; i++) levels.set(i, value);
    else if (t.kind === "group") groupLevels.set(t.group, value);
    else levels.set(t.addr, value);
  }

  /**
   * Apply a DALI frame (2 bytes) to the mock state.
   * Returns whether a fixture replied (only individual Query Actual Level does).
   */
  function applyDali(
    daliBytes: number[],
  ): { responded: boolean; replyValue?: number } {
    if (daliBytes.length < 2) return { responded: false };
    const addrByte = daliBytes[0]!;
    const cmdByte = daliBytes[1]!;
    const isCommand = addrByte % 2 === 1; // odd = command/query, even = DAPC

    // DAPC frame: the second byte IS the arc power level.
    if (!isCommand) {
      applyLevel(addrByte, cmdByte);
      return { responded: false };
    }

    // Query Actual Level — only an individual query yields a clean reply.
    if (cmdByte === DaliCmd.QUERY_LEVEL) {
      const t = resolveTarget(addrByte);
      if (t.kind === "individual") return { responded: true, replyValue: getLevel(t.addr) };
      return { responded: false }; // group/broadcast query → multiple responders, unreadable
    }

    // Standard commands map to a resulting level.
    switch (cmdByte) {
      case DaliCmd.OFF:         applyLevel(addrByte, 0);   break;
      case DaliCmd.RECALL_MAX:  applyLevel(addrByte, 254); break;
      default:
        if (cmdByte >= DaliCmd.RECALL_SCENE_0 && cmdByte <= 0x1F) {
          applyLevel(addrByte, 128); // simulate scene as ~50%
        }
        break;
    }
    return { responded: false };
  }

  const server: TCPSocketListener<Conn> = Bun.listen<Conn>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { decoder: new FrameDecoder() };
      },
      data(socket, chunk) {
        for (const data of socket.data.decoder.push(chunk)) {
          const type = data[0];
          received.push([...data]);

          if (type === MsgType.CONFIG_QUERY) {
            // Type 6: config query. item = data[1].
            const item = data[1] ?? 0;
            const value = item === 3 ? busStatus : 0;
            // Response Type 7: [0x07, item, highByte, lowByte]
            socket.write(encodeFrame([MsgType.CONFIG_RESP, item, (value >> 8) & 0xFF, value & 0xFF]));
            return;
          }

          if (type === MsgType.SEND || type === MsgType.SEND_ORIG) {
            // Type 1 / Type 11: send DALI.
            // Structure: [type, priority, bitLen, ...daliBytes] (+ flags byte for Type 11)
            const bitLen = data[2] ?? 0;
            const numBytes = Math.ceil(bitLen / 8);
            const daliBytes = data.slice(3, 3 + numBytes);

            const { responded, replyValue } = applyDali(daliBytes);

            if (type === MsgType.SEND_ORIG) {
              // Respond with Type 13 (with reply) or Type 14 (no reply).
              if (responded && replyValue !== undefined) {
                // Type 13: [0x0D, bitLen, ...daliBytes, replyBitLen=8, replyValue]
                socket.write(
                  encodeFrame([MsgType.ORIG_WITH_REPLY, bitLen, ...daliBytes, 0x08, replyValue]),
                );
              } else {
                // Type 14: [0x0E, bitLen, ...daliBytes, 0x00]
                socket.write(encodeFrame([MsgType.ORIG_NO_REPLY, bitLen, ...daliBytes, 0x00]));
              }
            } else {
              // Type 1: respond with Type 3 (with reply) or Type 4 (no reply).
              if (responded && replyValue !== undefined) {
                socket.write(
                  encodeFrame([MsgType.RECV_WITH_REPLY, bitLen, ...daliBytes, 0x08, replyValue]),
                );
              } else {
                socket.write(encodeFrame([MsgType.RECV_NO_REPLY, bitLen, ...daliBytes]));
              }
            }
          }
        }
      },
      close() {},
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(true),
    getLevel,
    getGroupLevel,
    setLevel: (addr, dapc) => levels.set(addr, dapc),
    setBusStatus: (s) => { busStatus = s; },
    received,
  };
}
