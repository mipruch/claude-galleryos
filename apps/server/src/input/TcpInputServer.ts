/**
 * TcpInputServer — TCP ingress that turns incoming messages into system actions.
 *
 * A thin transport over the shared {@link InputMapper}, the TCP sibling of
 * {@link OscServer}. It accepts persistent connections and reads
 * **newline-delimited JSON frames**: one JSON object per line, of the shape
 * `{ "address": "/scene/execute", "args": [..] }` (a bare JSON string is also
 * accepted as an address-only frame). For each frame it emits `input.tcp.received`
 * (audit) and hands a normalized `{ protocol: "tcp", address, args }` signal to
 * `InputMapper.handle()`, which does all the matching/templating/dispatch. The
 * same matcher backs OSC/HTTP, so the protocols behave identically.
 *
 * Framing and dispatch live in {@link feed} / {@link receiveFrame}, which are
 * independent of the socket so they can be unit-tested directly; `start()` only
 * binds the listener and forwards bytes to a per-connection buffer. A malformed
 * frame (bad JSON, missing address) is logged and dropped — a bad sender never
 * disrupts the server or its other connections. A single frame longer than
 * {@link MAX_FRAME_BYTES} (a client that never sends a newline) is dropped and
 * the buffer reset, so a misbehaving peer can't grow memory without bound.
 */

import { errMsg } from "@gallery/driver-core";
import type { EventBus } from "../core/EventBus.ts";
import type { Logger } from "../logger.ts";

/** The slice of InputMapper the TCP server needs (narrow, for hermetic tests). */
export interface TcpDispatcher {
  handle(signal: { protocol: string; address: string; args?: unknown[] }): Promise<unknown>;
}

export interface TcpInputServerOptions {
  inputMapper: TcpDispatcher;
  eventBus: EventBus;
  logger: Logger;
  /** TCP port to bind. Omit (or 0) for an OS-assigned port (tests). */
  port?: number;
  /** Bind address; defaults to all interfaces. */
  hostname?: string;
}

/** Per-connection state carried on the socket. */
interface ConnState {
  /** Bytes received but not yet terminated by a newline. */
  buffer: string;
  /** `addr:port` of the remote peer, for audit/logs. */
  from: string;
}

// The TCP socket Bun.listen hands to the handlers, parameterized by our state.
type TcpSocket = import("bun").Socket<ConnState>;
// Spelled out because `ReturnType<typeof Bun.listen>` widens to a TCP|Unix union;
// we always bind a TCP port, so pin the TCP listener (which exposes `.port`).
type TcpListener = import("bun").TCPSocketListener<ConnState>;

/** Cap on a single un-terminated frame; a longer one is dropped (DoS guard). */
const MAX_FRAME_BYTES = 64 * 1024;

export class TcpInputServer {
  private readonly log: Logger;
  private server: TcpListener | null = null;

  constructor(private readonly opts: TcpInputServerOptions) {
    this.log = opts.logger.child("tcp_input");
  }

  /** Bind the listener and begin accepting connections. */
  async start(): Promise<void> {
    if (this.server) return;
    this.server = Bun.listen<ConnState>({
      port: this.opts.port ?? 0,
      hostname: this.opts.hostname ?? "0.0.0.0",
      socket: {
        open: (socket) => {
          socket.data = { buffer: "", from: `${socket.remoteAddress}:${socket.localPort}` };
          this.log.debug("TCP client connected", { from: socket.data.from });
        },
        data: (socket, chunk) => {
          void this.feed(socket, chunk);
        },
        close: (socket) => {
          this.log.debug("TCP client disconnected", { from: socket.data?.from });
        },
        error: (socket, err) => {
          this.log.warn("TCP socket error", { from: socket.data?.from, error: errMsg(err) });
        },
      },
    });
    this.log.info("TCP input server listening", {
      port: this.server.port,
      protocol: "tcp",
    });
  }

  /** The bound TCP port (undefined before `start()`). */
  get port(): number | undefined {
    return this.server?.port;
  }

  /**
   * Buffer an inbound chunk and dispatch each complete, newline-terminated frame.
   * Socket-free framing logic lives in {@link extractFrames}; this method owns
   * the per-connection buffer carried on `socket.data`.
   */
  async feed(socket: TcpSocket, chunk: Uint8Array): Promise<void> {
    const state = socket.data;
    const text = state.buffer + Buffer.from(chunk).toString("utf8");
    const { frames, rest } = extractFrames(text);

    if (rest.length > MAX_FRAME_BYTES) {
      this.log.warn("dropped oversized TCP frame", { from: state.from, bytes: rest.length });
      state.buffer = "";
    } else {
      state.buffer = rest;
    }

    for (const frame of frames) await this.receiveFrame(frame, state.from);
  }

  /**
   * Decode one newline-stripped frame and dispatch it. Socket-free so tests can
   * drive it with a raw line. Blank lines (keep-alives) are ignored; a malformed
   * frame is logged and dropped without affecting the connection.
   */
  async receiveFrame(frame: string, from = "unknown"): Promise<void> {
    const line = frame.trim();
    if (line.length === 0) return;

    let address: string;
    let args: unknown[];
    try {
      const parsed = JSON.parse(line) as unknown;
      ({ address, args } = normalizeFrame(parsed));
    } catch (err) {
      this.log.warn("dropped malformed TCP frame", { from, error: errMsg(err) });
      return;
    }

    this.log.debug("TCP message", { from, address, args });
    this.opts.eventBus.emit({ type: "input.tcp.received", message: line, client: from });
    try {
      await this.opts.inputMapper.handle({ protocol: "tcp", address, args });
    } catch (err) {
      // InputMapper already swallows per-rule failures; this guards the rest.
      this.log.warn("TCP dispatch error", { address, error: errMsg(err) });
    }
  }

  /** Stop the listener and drop all connections. */
  stop(): void {
    this.server?.stop(true);
    this.server = null;
    this.log.info("TCP input server stopped");
  }
}

/**
 * Split buffered text into complete frames (without their trailing `\n`) and the
 * unterminated remainder. A trailing `\r` (CRLF senders) is stripped per frame.
 * Pure — exported for the framing tests.
 */
export function extractFrames(text: string): { frames: string[]; rest: string } {
  const parts = text.split("\n");
  const rest = parts.pop() ?? "";
  const frames = parts.map((p) => (p.endsWith("\r") ? p.slice(0, -1) : p));
  return { frames, rest };
}

/** A JSON object (not null, not an array). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Coerce a parsed JSON frame into `{ address, args }`. Accepts an object with a
 * string `address` (optional array `args`), or a bare string (address only).
 * Anything else throws — the caller drops it. Pure; exported for tests.
 */
export function normalizeFrame(parsed: unknown): { address: string; args: unknown[] } {
  if (typeof parsed === "string") return { address: parsed, args: [] };
  if (!isPlainObject(parsed)) throw new Error("frame must be a JSON object or string");
  if (typeof parsed.address !== "string") throw new Error("frame is missing a string `address`");
  const args = parsed.args ?? [];
  if (!Array.isArray(args)) throw new Error("frame `args` must be an array");
  return { address: parsed.address, args };
}
