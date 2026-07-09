/**
 * In-process mock of one or more Samsung MDC displays for tests.
 *
 * Speaks the Power Control (0x11) subset of the binary MDC protocol over a
 * Bun.listen TCP socket: a zero-length data frame is a GET (returns the
 * current power state), a one-byte data frame is a SET (0x00 off / 0x01 on),
 * answered with an ACK carrying the resulting state. Unknown display ids
 * answer with a NAK (error code 0x01); unknown commands answer with a NAK too.
 *
 * Multiple display ids are simulated on the same connection (as a real
 * RS232-over-Ethernet gateway or daisy-chain would present), keyed by the
 * frame's displayId byte.
 */

import type { Socket, TCPSocketListener } from "bun";
import { ACK, MDC_HEADER, NAK, POWER_COMMAND, PowerState, RESPONSE_MARKER } from "../src/mdc.ts";

export interface MdcMockOptions {
  /** Display ids the mock answers for (others get a NAK). Default: [1]. */
  displayIds?: number[];
  /** Initial power state per display id. Default: all off. */
  initialPower?: Record<number, number>;
}

export interface MdcMockServer {
  port: number;
  stop: () => void;
  /** Current power byte for a display id (0x00/0x01), or undefined if unknown. */
  powerOf: (displayId: number) => number | undefined;
  /** Every raw frame received, as hex strings, in order. */
  received: () => string[];
  /** Number of TCP connections opened so far. */
  connections: () => number;
}

interface Conn {
  buf: number[];
}

function checksum(bytes: readonly number[]): number {
  return bytes.reduce((sum, b) => sum + (b & 0xff), 0) & 0xff;
}

function ackFrame(displayId: number, command: number, data: number[]): Buffer {
  const payload = [ACK, command, ...data];
  const body = [RESPONSE_MARKER, displayId, payload.length, ...payload];
  return Buffer.from([MDC_HEADER, ...body, checksum(body)]);
}

function nakFrame(displayId: number, command: number, errorCode: number): Buffer {
  const payload = [NAK, command, errorCode];
  const body = [RESPONSE_MARKER, displayId, payload.length, ...payload];
  return Buffer.from([MDC_HEADER, ...body, checksum(body)]);
}

export function startMdcMock(opts: MdcMockOptions = {}): MdcMockServer {
  const displayIds = new Set(opts.displayIds ?? [1]);
  const power = new Map<number, number>();
  for (const id of displayIds) power.set(id, opts.initialPower?.[id] ?? PowerState.OFF);

  const receivedFrames: string[] = [];
  let connectionCount = 0;

  function handleFrame(socket: Socket<Conn>, frame: number[]): void {
    receivedFrames.push(Buffer.from(frame).toString("hex"));

    const command = frame[1]!;
    const displayId = frame[2]!;
    const len = frame[3]!;
    const data = frame.slice(4, 4 + len);

    if (!displayIds.has(displayId)) {
      socket.write(nakFrame(displayId, command, 0x01)); // unknown display id
      return;
    }

    if (command !== POWER_COMMAND) {
      socket.write(nakFrame(displayId, command, 0x02)); // unsupported command
      return;
    }

    if (data.length === 0) {
      // GET: reply with the current power state.
      socket.write(ackFrame(displayId, command, [power.get(displayId) ?? PowerState.OFF]));
      return;
    }

    // SET.
    const requested = data[0]!;
    if (requested !== PowerState.OFF && requested !== PowerState.ON && requested !== PowerState.REBOOT) {
      socket.write(nakFrame(displayId, command, 0x03)); // invalid data
      return;
    }
    power.set(displayId, requested);
    socket.write(ackFrame(displayId, command, [requested]));
  }

  const server: TCPSocketListener<Conn> = Bun.listen<Conn>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buf: [] };
        connectionCount += 1;
      },
      data(socket, chunk) {
        for (const byte of chunk) socket.data.buf.push(byte);
        // Frames are length-prefixed: header(1) + cmd(1) + id(1) + len(1) + data[len] + checksum(1).
        while (socket.data.buf.length >= 4) {
          if (socket.data.buf[0] !== MDC_HEADER) {
            socket.data.buf.shift();
            continue;
          }
          const len = socket.data.buf[3]!;
          const total = 4 + len + 1;
          if (socket.data.buf.length < total) break;
          const frame = socket.data.buf.slice(0, total);
          socket.data.buf = socket.data.buf.slice(total);
          handleFrame(socket, frame);
        }
      },
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(true),
    powerOf: (displayId) => power.get(displayId),
    received: () => [...receivedFrames],
    connections: () => connectionCount,
  };
}
