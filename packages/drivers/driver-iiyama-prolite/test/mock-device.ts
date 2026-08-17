/**
 * In-process mock of one Iiyama ProLite display for tests.
 *
 * Speaks the Power state Get/Set subset of the binary RS232-over-LAN
 * protocol over a Bun.listen TCP socket:
 *  - Power Get (`data[0] = 0x19`) → replies with a Power state report
 *    (`data = [0x19, powerByte]`).
 *  - Power Set Off (`data[0] = 0x18, data[1] = 0x01`) → updates power to off
 *    and replies with the Communication Control "Completed" confirmation
 *    (`data = [0x00, 0x00]`), matching the manufacturer-documented sequence.
 *  - Anything else is ignored (no reply), so a test can also exercise the
 *    driver's response-timeout path.
 */

import type { Socket, TCPSocketListener } from "bun";
import {
  COMMAND_HEADER,
  CommStatus,
  FUNC_COMM_CONTROL,
  FUNC_POWER_GET,
  FUNC_POWER_SET,
  PowerState,
  REPORT_HEADER,
} from "../src/iiyama.ts";

export interface IiyamaMockOptions {
  /** Initial power state. Default: off. */
  initialPower?: number;
  /** When true, Power Get/Set requests are received but never answered. */
  silent?: boolean;
}

export interface IiyamaMockServer {
  port: number;
  stop: () => void;
  power: () => number;
  /** Every raw frame received, as hex strings, in order. */
  received: () => string[];
  connections: () => number;
}

interface Conn {
  buf: number[];
}

function xor(bytes: readonly number[]): number {
  return bytes.reduce((acc, b) => acc ^ (b & 0xff), 0);
}

function reportFrame(monitorId: number, data: number[]): Buffer {
  const length = data.length + 2;
  const body = [REPORT_HEADER, monitorId, 0x00, 0x00, length, 0x01, ...data];
  return Buffer.from([...body, xor(body)]);
}

export function startIiyamaMock(opts: IiyamaMockOptions = {}): IiyamaMockServer {
  let power = opts.initialPower ?? PowerState.OFF;
  const silent = opts.silent ?? false;

  const receivedFrames: string[] = [];
  let connectionCount = 0;

  function handleFrame(socket: Socket<Conn>, frame: number[]): void {
    receivedFrames.push(Buffer.from(frame).toString("hex"));
    if (silent) return;

    const monitorId = frame[1]!;
    const length = frame[5]!;
    const data = frame.slice(7, 5 + length);
    const func = data[0];

    if (func === FUNC_POWER_GET) {
      socket.write(reportFrame(monitorId, [FUNC_POWER_GET, power]));
      return;
    }
    if (func === FUNC_POWER_SET) {
      power = data[1] ?? power;
      socket.write(reportFrame(monitorId, [FUNC_COMM_CONTROL, CommStatus.COMPLETED]));
      return;
    }
    // Unknown function: no reply.
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
        // Frames: header(1) monitorId(1) 0x00 0x00 0x00 length(1) dataControl(1) data[len-2] checksum(1).
        while (socket.data.buf.length >= 6) {
          if (socket.data.buf[0] !== COMMAND_HEADER) {
            socket.data.buf.shift();
            continue;
          }
          const length = socket.data.buf[5]!;
          const total = 6 + length;
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
    power: () => power,
    received: () => [...receivedFrames],
    connections: () => connectionCount,
  };
}
