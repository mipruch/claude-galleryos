/**
 * OscServer — UDP ingress that turns incoming OSC messages into system actions.
 *
 * A thin transport over the shared {@link InputMapper}: for each datagram it
 * decodes the OSC packet (`src/input/osc.ts`), and for every message it carries
 * it emits `input.osc.received` (audit) and hands a normalized
 * `{ protocol: "osc", address, args }` signal to `InputMapper.handle()`, which
 * does all the matching/templating/dispatch. The same matcher backs TCP/HTTP, so
 * the protocols behave identically.
 *
 * The decode and dispatch live in {@link receive}, which is independent of the
 * socket so it can be unit-tested directly; `start()` only binds a UDP socket and
 * forwards datagrams to it. A malformed packet is logged and dropped — a bad
 * sender never disrupts the server.
 */

import { errMsg } from "@gallery/driver-core";
import type { EventBus } from "../core/EventBus.ts";
import type { Logger } from "../logger.ts";
import { type OscMessage, decodeOscPacket } from "./osc.ts";

/** The slice of InputMapper the OSC server needs (narrow, for hermetic tests). */
export interface OscDispatcher {
  handle(signal: { protocol: string; address: string; args?: unknown[] }): Promise<unknown>;
}

export interface OscServerOptions {
  inputMapper: OscDispatcher;
  eventBus: EventBus;
  logger: Logger;
  /** UDP port to bind. Omit (or 0) for an OS-assigned port (tests). */
  port?: number;
  /** Bind address; defaults to all interfaces. */
  hostname?: string;
}

// The unconnected datagram socket (Bun.udpSocket's no-`connect` overload). Spelled
// out because `ReturnType<typeof Bun.udpSocket>` picks the *connected* overload.
type UdpSocket = import("bun").udp.Socket<"buffer">;

export class OscServer {
  private readonly log: Logger;
  private socket: UdpSocket | null = null;

  constructor(private readonly opts: OscServerOptions) {
    this.log = opts.logger.child("osc_input");
  }

  /** Bind the UDP socket and begin dispatching datagrams. */
  async start(): Promise<void> {
    if (this.socket) return;
    const socket: UdpSocket = await Bun.udpSocket({
      port: this.opts.port,
      hostname: this.opts.hostname,
      socket: {
        data: (_socket, buf, port, addr) => {
          void this.receive(buf, `${addr}:${port}`);
        },
        error: (_socket, err) => {
          this.log.error("OSC socket error", { error: errMsg(err) });
        },
      },
    });
    this.socket = socket;
    this.log.info("OSC input server listening", { port: socket.port, protocol: "udp" });
  }

  /** The bound UDP port (undefined before `start()`). */
  get port(): number | undefined {
    return this.socket?.port;
  }

  /**
   * Decode one datagram and dispatch every message it carries. Socket-free so
   * tests can drive it with raw bytes.
   */
  async receive(datagram: Uint8Array, from = "unknown"): Promise<void> {
    let messages: OscMessage[];
    try {
      messages = decodeOscPacket(datagram);
    } catch (err) {
      this.log.warn("dropped malformed OSC packet", {
        from,
        bytes: datagram.length,
        error: errMsg(err),
      });
      return;
    }

    for (const msg of messages) {
      this.log.debug("OSC message", { from, address: msg.address, args: msg.args });
      this.opts.eventBus.emit({ type: "input.osc.received", address: msg.address, args: msg.args });
      try {
        await this.opts.inputMapper.handle({ protocol: "osc", address: msg.address, args: msg.args });
      } catch (err) {
        // InputMapper already swallows per-rule failures; this guards the rest.
        this.log.warn("OSC dispatch error", { address: msg.address, error: errMsg(err) });
      }
    }
  }

  /** Close the UDP socket. */
  stop(): void {
    this.socket?.close();
    this.socket = null;
    this.log.info("OSC input server stopped");
  }
}
