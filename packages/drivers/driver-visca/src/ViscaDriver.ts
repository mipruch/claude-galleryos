/**
 * VISCA over TCP PTZ camera driver.
 *
 * VISCA (Video Systems Control Architecture) is Sony's PTZ control protocol,
 * widely supported across camera brands. This driver speaks raw VISCA over a
 * persistent TCP socket (typically port 5678 for PTZOptics-style cameras).
 *
 * Protocol summary:
 *  - All frames end with 0xFF as the terminator byte.
 *  - Commands start with the camera address byte: 0x80 | cameraId (e.g. 0x81 for camera 1).
 *  - Responses are either:
 *      ACK:        [y0 4y FF] — command accepted, camera is processing it.
 *      Completion: [y0 5y FF] — command completed successfully.
 *      Error:      [y0 6y 0z FF] — error response (z = error code).
 *  - Cameras may send only Completion (no ACK first), or ACK followed by Completion.
 *  - Inquiry reply: [y0 50 <data...> FF] — data payload follows.
 *
 * The driver maintains a persistent socket and reconnects with exponential
 * backoff. Commands are serialised (one at a time) so responses are never
 * scrambled. A poll timer reads power state and emits `state` events.
 */

import { EventEmitter } from "node:events";
import type { Socket } from "bun";
import {
  type CommandResult,
  type ConnectionConfig,
  type DriverContext,
  type EndpointDescriptor,
  type HealthStatus,
  type IDeviceDriver,
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";

// ── VISCA command builders ────────────────────────────────────────────────────

const FRAME_END = 0xff;

function buildCommand(cameraId: number, ...bytes: number[]): Uint8Array {
  return new Uint8Array([0x80 | cameraId, ...bytes, FRAME_END]);
}

function panDirByte(dir: string): number {
  if (dir === "right") return 0x01;
  if (dir === "left") return 0x02;
  return 0x03; // stop
}

function tiltDirByte(dir: string): number {
  if (dir === "up") return 0x01;
  if (dir === "down") return 0x02;
  return 0x03; // stop
}

// ── Response parser ───────────────────────────────────────────────────────────

type ParsedFrame =
  | { kind: "ack" }
  | { kind: "completion" }
  | { kind: "error"; code: number }
  | { kind: "inquiry"; payload: Uint8Array };

function parseFrame(frame: Uint8Array): ParsedFrame {
  if (frame.length < 2) return { kind: "completion" };
  const b1 = frame[1]!;
  const hi = (b1 >> 4) & 0x0f;
  if (hi === 0x04) return { kind: "ack" };
  if (hi === 0x05) {
    if (frame.length > 3) {
      return { kind: "inquiry", payload: frame.slice(2, frame.length - 1) };
    }
    return { kind: "completion" };
  }
  if (hi === 0x06 && frame.length >= 4) {
    return { kind: "error", code: frame[2]! & 0x0f };
  }
  return { kind: "completion" };
}

const VISCA_ERROR_MSGS: Record<number, string> = {
  1: "message length error",
  2: "syntax error",
  3: "command buffer full",
  4: "command cancelled",
  5: "no socket",
  0x41: "command not executable",
};

// ── Driver ────────────────────────────────────────────────────────────────────

export class ViscaDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  // ── config ────────────────────────────────────────────────────────────────
  private host = "";
  private port = 5678;
  private cameraId = 1;
  private responseTimeoutMs = 2000;
  private pollIntervalMs = 30_000;
  private reconnectMs = 2000;

  // ── runtime ───────────────────────────────────────────────────────────────
  private ctx!: DriverContext;
  private socket: Socket | null = null;
  private online = false;
  private destroyed = false;

  /** Raw byte accumulation buffer. Frames are sliced out on each 0xFF. */
  private rxBuffer: number[] = [];

  /**
   * Queue of one-shot frame listeners. The head is resolved on the next
   * complete incoming frame. Serialised access keeps VISCA responses matched
   * to the right command.
   */
  private frameWaiters: Array<{
    resolve: (frame: Uint8Array) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  /** Mutex: only one command transaction is in-flight at a time. */
  private txLock: Promise<unknown> = Promise.resolve();

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Endpoint id, set by subscribeToEndpoint so polls can tag state events. */
  private endpointId: string | null = null;

  /** Latest known power state — returned instantly by healthCheck / readState. */
  private powerState: "on" | "off" | "unknown" = "unknown";

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 5678;
    this.cameraId = Number(config.config.cameraAddress ?? 1);
    this.responseTimeoutMs = Number(config.config.responseTimeoutMs ?? 2000);
    this.pollIntervalMs = Number(config.config.pollIntervalMs ?? 30_000);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
    });
    ctx.logger.debug("visca init", { host: this.host, port: this.port, cameraId: this.cameraId });
  }

  async connect(): Promise<void> {
    if (this.destroyed) return;
    try {
      await this.openSocket();
      this.online = true;
      this.reconnectMs = 2000;
      this.emit("connected");
      this.schedulePoll(0);
    } catch (err) {
      this.online = false;
      const reason = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("visca connect failed", { reason });
      this.emit("disconnected", reason);
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.clearTimers();
    this.closeSocket("local disconnect");
    this.online = false;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  // ── Status ────────────────────────────────────────────────────────────────

  isConnected(): boolean {
    return this.online;
  }

  async healthCheck(): Promise<HealthStatus> {
    return { online: this.online, checkedAt: new Date() };
  }

  // ── Subscriptions (poll-mode push emulation) ─────────────────────────────

  async subscribeToEndpoint(endpoint: EndpointDescriptor): Promise<void> {
    this.endpointId = endpoint.id;
  }

  async unsubscribeFromEndpoint(_endpoint: EndpointDescriptor): Promise<void> {
    this.endpointId = null;
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();

    if (this.ctx.dryRun) {
      this.ctx.logger.info("visca dry-run", { command, params });
      return { success: true, durationMs: Date.now() - start };
    }

    try {
      const state = await this.runCommand(command, params);
      this.online = true;
      if (state) {
        this.emit("state", {
          endpointId: endpoint.id,
          state,
          source: "echo",
          timestamp: new Date(),
        });
      }
      // Reset poll timer — camera was just contacted
      this.schedulePoll(this.pollIntervalMs);
      return { success: true, durationMs: Date.now() - start, state: state ?? undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("visca command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    if (this.ctx.dryRun) return { power: this.powerState };
    try {
      const state = await this.doInquirePower();
      this.emit("state", {
        endpointId: endpoint.id,
        state,
        source: "poll",
        timestamp: new Date(),
      });
      return state;
    } catch {
      return { power: this.powerState };
    }
  }

  // ── Command translation ───────────────────────────────────────────────────

  private async runCommand(
    command: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const id = this.cameraId;
    switch (command) {
      case "on":
        await this.transaction(buildCommand(id, 0x01, 0x04, 0x00, 0x02));
        this.powerState = "on";
        return { power: "on" };
      case "off":
        await this.transaction(buildCommand(id, 0x01, 0x04, 0x00, 0x03));
        this.powerState = "off";
        return { power: "off" };
      case "home":
        await this.transaction(buildCommand(id, 0x01, 0x06, 0x04));
        return null;
      case "recallPreset": {
        const preset = Math.min(15, Math.max(0, Number(params.preset ?? 0)));
        await this.transaction(buildCommand(id, 0x01, 0x04, 0x3f, 0x02, preset));
        return { preset };
      }
      case "savePreset": {
        const preset = Math.min(15, Math.max(0, Number(params.preset ?? 0)));
        await this.transaction(buildCommand(id, 0x01, 0x04, 0x3f, 0x01, preset));
        return null;
      }
      case "move": {
        const pan = String(params.pan ?? "stop");
        const tilt = String(params.tilt ?? "stop");
        const ps = Math.min(18, Math.max(1, Number(params.panSpeed ?? 8)));
        const ts = Math.min(17, Math.max(1, Number(params.tiltSpeed ?? 8)));
        if (pan === "stop" && tilt === "stop") {
          await this.transaction(buildCommand(id, 0x01, 0x06, 0x01, 0x00, 0x00, 0x03, 0x03));
        } else {
          await this.transaction(
            buildCommand(id, 0x01, 0x06, 0x01, ps, ts, panDirByte(pan), tiltDirByte(tilt)),
          );
        }
        return null;
      }
      case "zoomIn":
        await this.transaction(buildCommand(id, 0x01, 0x04, 0x07, 0x02));
        return null;
      case "zoomOut":
        await this.transaction(buildCommand(id, 0x01, 0x04, 0x07, 0x03));
        return null;
      case "zoomStop":
        await this.transaction(buildCommand(id, 0x01, 0x04, 0x07, 0x00));
        return null;
      default:
        throw new Error(`unknown command: ${command}`);
    }
  }

  // ── Power inquiry ─────────────────────────────────────────────────────────

  private async doInquirePower(): Promise<Record<string, unknown>> {
    const id = this.cameraId;
    // Power inquiry: 8x 09 04 00 FF
    const frame = await this.transactionRaw(buildCommand(id, 0x09, 0x04, 0x00));
    const r = parseFrame(frame);
    let power: "on" | "off" | "unknown" = "unknown";
    if (r.kind === "inquiry" && r.payload.length >= 1) {
      const v = r.payload[0]!;
      if (v === 0x02) power = "on";
      else if (v === 0x03) power = "off";
    }
    this.powerState = power;
    return { power };
  }

  // ── Poll timer ────────────────────────────────────────────────────────────

  private schedulePoll(delayMs: number): void {
    if (this.destroyed) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.runPoll(), delayMs);
  }

  private runPoll(): void {
    if (this.destroyed || !this.online) return;
    this.doInquirePower()
      .then((state) => {
        if (this.endpointId) {
          this.emit("state", {
            endpointId: this.endpointId,
            state,
            source: "poll",
            timestamp: new Date(),
          });
        }
      })
      .catch((err) => {
        this.ctx.logger.debug("visca poll error", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.schedulePoll(this.pollIntervalMs);
      });
  }

  // ── Socket management ─────────────────────────────────────────────────────

  private openSocket(): Promise<void> {
    const connectTimeout = this.responseTimeoutMs * 2;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`connect timeout after ${connectTimeout}ms`));
      }, connectTimeout);

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        err ? reject(err) : resolve();
      };

      Bun.connect({
        hostname: this.host,
        port: this.port,
        socket: {
          open: (socket) => {
            this.socket = socket;
            this.rxBuffer = [];
            finish();
          },
          data: (_socket, chunk) => this.handleData(chunk),
          close: () => this.handleSocketClose("remote close"),
          end: () => this.handleSocketClose("remote end"),
          error: (_socket, error) => {
            finish(error instanceof Error ? error : new Error(String(error)));
            this.handleSocketClose(`error: ${String(error)}`);
          },
          connectError: (_socket, error) => {
            finish(error instanceof Error ? error : new Error(String(error)));
          },
        },
      }).catch(finish);
    });
  }

  private closeSocket(reason: string): void {
    if (this.socket) {
      try {
        this.socket.end();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.flushWaiters(new Error(reason));
  }

  private handleSocketClose(reason: string): void {
    const wasOnline = this.online;
    this.socket = null;
    this.rxBuffer = [];
    this.online = false;
    this.flushWaiters(new Error(`connection ${reason}`));
    if (wasOnline) this.emit("disconnected", reason);
    if (!this.destroyed) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    const delay = this.reconnectMs;
    this.reconnectMs = Math.min(delay * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        this.ctx.logger.info("visca reconnecting", { host: this.host, delay });
        this.connect().catch(() => {});
      }
    }, delay);
  }

  private clearTimers(): void {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  // ── Binary frame handling ─────────────────────────────────────────────────

  private handleData(chunk: Uint8Array): void {
    for (const byte of chunk) {
      this.rxBuffer.push(byte);
      if (byte === FRAME_END) {
        const frame = new Uint8Array(this.rxBuffer);
        this.rxBuffer = [];
        const waiter = this.frameWaiters.shift();
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(frame);
        }
        // Unsolicited frames are silently discarded — VISCA cameras don't
        // send push notifications; everything is request/response.
      }
    }
  }

  private flushWaiters(err: Error): void {
    while (this.frameWaiters.length) {
      const w = this.frameWaiters.shift()!;
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  // ── Serialised transaction ────────────────────────────────────────────────

  /**
   * Send a VISCA command, skip any ACK frames, and return the first
   * Completion or Inquiry frame. Throws on error frames.
   */
  private transaction(cmd: Uint8Array): Promise<void> {
    const run = this.txLock.then(async () => {
      let frame = await this.rawReadFrame(cmd);
      // If camera sends ACK first, read the following Completion frame.
      let r = parseFrame(frame);
      if (r.kind === "ack") {
        frame = await this.rawReadFrame(null);
        r = parseFrame(frame);
      }
      if (r.kind === "error") {
        throw new Error(
          `VISCA error: ${VISCA_ERROR_MSGS[r.code] ?? `code 0x${r.code.toString(16)}`}`,
        );
      }
    });
    this.txLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Same as `transaction` but returns the raw frame for inquiry parsing.
   * ACK frames are skipped.
   */
  private transactionRaw(cmd: Uint8Array): Promise<Uint8Array> {
    const run = this.txLock.then(async () => {
      let frame = await this.rawReadFrame(cmd);
      let r = parseFrame(frame);
      if (r.kind === "ack") {
        frame = await this.rawReadFrame(null);
        r = parseFrame(frame);
      }
      if (r.kind === "error") {
        throw new Error(
          `VISCA error: ${VISCA_ERROR_MSGS[r.code] ?? `code 0x${r.code.toString(16)}`}`,
        );
      }
      return frame;
    });
    this.txLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Register a frame waiter, optionally send `cmd` bytes, and resolve with
   * the next complete frame. `cmd === null` means read-only (after ACK).
   */
  private rawReadFrame(cmd: Uint8Array | null): Promise<Uint8Array> {
    if (this.destroyed) return Promise.reject(new Error("driver destroyed"));
    if (!this.socket) return Promise.reject(new Error("socket not connected"));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.frameWaiters.findIndex((w) => w.timer === timer);
        if (idx !== -1) this.frameWaiters.splice(idx, 1);
        reject(new Error(`VISCA response timeout after ${this.responseTimeoutMs}ms`));
      }, this.responseTimeoutMs);

      this.frameWaiters.push({ resolve, reject, timer });

      if (cmd !== null && cmd.length > 0 && this.socket) {
        this.socket.write(cmd);
      }
    });
  }
}
