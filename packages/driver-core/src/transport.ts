/**
 * Bun-native TCP transport helper for drivers.
 *
 * Wraps `Bun.connect` with delimiter-buffered, sequential request/response
 * semantics — the pattern almost every text-based AV protocol uses (PJLink,
 * Extron SIS, Samsung MDC, simple relay boxes, …). Drivers stay focused on
 * protocol encoding instead of socket plumbing.
 *
 * Design notes:
 *  - One request is in flight at a time (a FIFO of waiters). Responses are
 *    matched to the head of the queue. This matches how these devices behave.
 *  - Inbound bytes are buffered and split on `rxDelimiter`; each complete frame
 *    resolves the next waiter, or — if none is waiting — is delivered to
 *    `onMessage` (for push/subscription protocols) and otherwise queued in an
 *    inbox so an immediately-following `receive()` won't miss it (e.g. a PJLink
 *    auth banner that arrives the instant the socket opens).
 */

import type { Socket } from "bun";

export interface TcpClientOptions {
  hostname: string;
  port: number;
  /** Frame delimiter for inbound data. Default CRLF. */
  rxDelimiter?: string;
  /** Delimiter appended by `sendLine`/`request`. Defaults to `rxDelimiter`. */
  txDelimiter?: string;
  /** Text encoding used to decode inbound bytes. Default "utf-8". */
  encoding?: BufferEncoding;
  /** Max time to wait for the socket to open. Default 3000ms. */
  connectTimeoutMs?: number;
  /**
   * Close mode for `close()`. `"graceful"` (default) sends a FIN via
   * `socket.end()` and leaves the connection half-open until the peer also
   * closes. `"force"` calls `socket.terminate()` (SO_LINGER 0 → RST) to tear the
   * connection down immediately — required for devices that only free their
   * single connection slot when the connection is fully gone (e.g. PJLink
   * projectors, which otherwise hold the slot until their own idle timeout and
   * make the next connect time out).
   */
  closeMode?: "graceful" | "force";
}

interface Waiter {
  resolve: (frame: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TcpClient {
  private socket: Socket | null = null;
  private connected = false;
  private buffer = "";
  private readonly waiters: Waiter[] = [];
  private readonly inbox: string[] = [];

  private readonly rxDelimiter: string;
  private readonly txDelimiter: string;
  private readonly encoding: BufferEncoding;
  private readonly connectTimeoutMs: number;
  private readonly closeMode: "graceful" | "force";

  /** Set to receive unsolicited frames (when no `receive()` is pending). */
  onMessage?: (frame: string) => void;
  /** Called when the socket closes (remote close, error, or local close). */
  onClose?: (reason: string) => void;

  constructor(private readonly options: TcpClientOptions) {
    this.rxDelimiter = options.rxDelimiter ?? "\r\n";
    this.txDelimiter = options.txDelimiter ?? this.rxDelimiter;
    this.encoding = options.encoding ?? "utf-8";
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3000;
    this.closeMode = options.closeMode ?? "graceful";
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Open the socket. Resolves once connected; rejects on failure/timeout. */
  async connect(): Promise<void> {
    if (this.connected) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`connect timeout after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        err ? reject(err) : resolve();
      };

      Bun.connect({
        hostname: this.options.hostname,
        port: this.options.port,
        socket: {
          open: (socket) => {
            this.socket = socket;
            this.connected = true;
            finish();
          },
          data: (_socket, chunk) => this.handleData(chunk),
          close: () => this.handleClose("closed"),
          end: () => this.handleClose("ended"),
          error: (_socket, error) => {
            // If we never opened, surface as a connect failure.
            finish(error instanceof Error ? error : new Error(String(error)));
            this.handleClose(`error: ${String(error)}`);
          },
          connectError: (_socket, error) => {
            finish(error instanceof Error ? error : new Error(String(error)));
          },
        },
      }).catch(finish);
    });
  }

  /** Append the tx delimiter and write the frame. */
  sendLine(payload: string): void {
    this.write(payload + this.txDelimiter);
  }

  /** Write raw bytes/string with no delimiter handling. */
  write(payload: string): void {
    if (!this.socket || !this.connected) {
      throw new Error("cannot write: socket not connected");
    }
    this.socket.write(payload);
  }

  /** Resolve with the next inbound frame (from inbox or once it arrives). */
  receive(timeoutMs: number): Promise<string> {
    const buffered = this.inbox.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`receive timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  /** Send a line then await one response frame. */
  async request(payload: string, timeoutMs: number): Promise<string> {
    const response = this.receive(timeoutMs);
    this.sendLine(payload);
    return response;
  }

  /** Close the socket and reject any pending waiters. */
  close(): void {
    if (this.closeMode === "force") this.socket?.terminate();
    else this.socket?.end();
    this.handleClose("local close");
  }

  // ── internals ──────────────────────────────────────────────

  private handleData(chunk: Uint8Array): void {
    this.buffer += Buffer.from(chunk).toString(this.encoding);
    let idx: number;
    while ((idx = this.buffer.indexOf(this.rxDelimiter)) !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + this.rxDelimiter.length);
      this.dispatch(frame);
    }
  }

  private dispatch(frame: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    } else if (this.onMessage) {
      this.onMessage(frame);
    } else {
      this.inbox.push(frame);
    }
  }

  private handleClose(reason: string): void {
    if (!this.connected && this.socket === null && this.waiters.length === 0) return;
    this.connected = false;
    this.socket = null;
    this.buffer = "";
    const err = new Error(`connection ${reason}`);
    while (this.waiters.length) {
      const waiter = this.waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.onClose?.(reason);
  }
}
