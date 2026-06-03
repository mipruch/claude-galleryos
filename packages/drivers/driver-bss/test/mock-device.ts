/**
 * In-process mock of a BSS Soundweb London device for tests.
 *
 * Speaks the London DI protocol over a Bun.listen TCP socket: decodes inbound
 * frames, stores per-parameter values, answers SUBSCRIBE with the current value
 * (and pushes on subsequent changes), and lets the test inject external value
 * changes to exercise the driver's inbound routing.
 *
 * It reuses the driver's own codec for framing — the codec has dedicated unit
 * tests (`london-di.test.ts`), so the mock can trust it.
 */

import type { Socket, TCPSocketListener } from "bun";
import {
  type ParameterAddress,
  FrameDecoder,
  MsgType,
  decodeFrame,
  encodeAddressMessage,
} from "../src/london-di.ts";

export interface BssMockServer {
  port: number;
  stop: () => void;
  /** Peek a stored raw value by address (undefined if never set). */
  getValue: (addr: ParameterAddress) => number | undefined;
  /** All received message types in order (for assertions). */
  received: () => number[];
  /** Inject an external value change; pushes to subscribers. */
  setValue: (addr: ParameterAddress, value: number, percent?: boolean) => void;
}

interface Conn {
  decoder: FrameDecoder;
}

function key(a: ParameterAddress): string {
  return `${a.node}:${a.virtualDevice}:${a.object}:${a.param}`;
}

export function startBssMock(): BssMockServer {
  const values = new Map<string, number>();
  const subscribed = new Set<string>();
  const receivedTypes: number[] = [];
  const sockets = new Set<Socket<Conn>>();
  const addrByKey = new Map<string, ParameterAddress>();

  const server: TCPSocketListener<Conn> = Bun.listen<Conn>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { decoder: new FrameDecoder() };
        sockets.add(socket);
      },
      close(socket) {
        sockets.delete(socket);
      },
      data(socket, chunk) {
        for (const inner of socket.data.decoder.push(chunk)) {
          const msg = decodeFrame(inner);
          if (!msg) continue;
          receivedTypes.push(msg.type);
          const addr: ParameterAddress = {
            node: msg.node,
            virtualDevice: msg.virtualDevice,
            object: msg.object,
            param: msg.param,
          };
          const k = key(addr);
          addrByKey.set(k, addr);

          switch (msg.type) {
            case MsgType.SET:
            case MsgType.SET_PERCENT:
              values.set(k, msg.value);
              if (subscribed.has(k)) pushValue(addr, msg.value, msg.type === MsgType.SET_PERCENT);
              break;
            case MsgType.SUBSCRIBE:
              subscribed.add(k);
              pushValue(addr, values.get(k) ?? 0, false);
              break;
            case MsgType.SUBSCRIBE_PERCENT:
              subscribed.add(k);
              pushValue(addr, values.get(k) ?? 0, true);
              break;
            case MsgType.UNSUBSCRIBE:
            case MsgType.UNSUBSCRIBE_PERCENT:
              subscribed.delete(k);
              break;
          }
        }
      },
    },
  });

  /** Frame + write a SET / SET_PERCENT push to every open socket. */
  function pushValue(addr: ParameterAddress, value: number, percent: boolean): void {
    const frame = encodeAddressMessage(percent ? MsgType.SET_PERCENT : MsgType.SET, addr, value);
    for (const s of sockets) s.write(frame);
  }

  return {
    port: server.port,
    stop: () => server.stop(),
    getValue: (addr) => values.get(key(addr)),
    received: () => [...receivedTypes],
    setValue: (addr, value, percent = false) => {
      const k = key(addr);
      addrByKey.set(k, addr);
      values.set(k, value);
      if (subscribed.has(k)) pushValue(addr, value, percent);
    },
  };
}
