/**
 * Samsung MDC display driver (binary MDC protocol over TCP 1515).
 *
 * One persistent socket per connection is shared by every display endpoint —
 * multiple sets can sit behind one RS232-over-Ethernet gateway, or several
 * built-in MDC/LAN ports can be reached through one link, each addressed by
 * its own MDC display ID. The driver:
 *   - keeps the socket open and reconnects with backoff if it drops;
 *   - translates `on` / `off` into Power Control (0x11) SET frames, and
 *     `readState` into a Power Control GET (zero-length data);
 *   - serialises device I/O behind a mutex (one transaction at a time) and
 *     matches each response to the in-flight request by displayId + echoed
 *     command, since several displays share the wire.
 *
 * Binary framing is delegated to the pure `mdc.ts` codec; this file owns the
 * socket lifecycle, request/response correlation, and command translation.
 *
 * Only Power Control is implemented — see `manifest.ts` / PLAN.md §1.5 for
 * what's deliberately left out (input select, video wall, …).
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
import {
  type MdcResponse,
  MdcFrameDecoder,
  POWER_COMMAND,
  PowerState,
  decodePowerState,
  encodePowerQuery,
  encodePowerSet,
} from "./mdc.ts";

/** A pending request awaiting its response, correlated by displayId + command. */
interface Pending {
  displayId: number;
  command: number;
  resolve: (r: MdcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type DisplayState = { power?: "on" | "off" | "unknown" };

export class SamsungMdcDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  // ── config ─────────────────────────────────────────────────
  private host = "";
  private port = 1515;
  private responseTimeoutMs = 2000;
  private reconnectMs = 2000;

  // ── runtime ────────────────────────────────────────────────
  private ctx!: DriverContext;
  private socket: Socket | null = null;
  private online = false;
  private destroyed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly decoder = new MdcFrameDecoder();

  /** The single in-flight request (one transaction at a time). */
  private pending: Pending | null = null;
  /** Serialises transactions so responses match the right request. */
  private lock: Promise<unknown> = Promise.resolve();

  /** Latest known power state per display id. */
  private readonly stateCache = new Map<number, DisplayState>();
  /** Simulated state per display id (dry-run). */
  private readonly simState = new Map<number, DisplayState>();

  // ── lifecycle ──────────────────────────────────────────────

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 1515;
    this.responseTimeoutMs = Number(config.config.responseTimeoutMs ?? 2000);
    this.reconnectMs = Number(config.config.reconnectMs ?? 2000);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
      this.clearReconnect();
    });
    ctx.logger.debug("samsung-mdc init", { host: this.host, port: this.port });
  }

  async connect(): Promise<void> {
    if (this.ctx.dryRun) {
      // No socket in dry-run; pretend we're online so scenes can preview.
      this.online = true;
      this.emit("connected");
      return;
    }
    await this.openSocket();
  }

  async disconnect(): Promise<void> {
    this.clearReconnect();
    this.online = false;
    const sock = this.socket;
    this.socket = null;
    this.decoder.reset();
    sock?.end();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  // ── status ─────────────────────────────────────────────────

  isConnected(): boolean {
    return this.online;
  }

  /** Connection-level probe: the socket is either up or it isn't. */
  async healthCheck(): Promise<HealthStatus> {
    return { online: this.online, checkedAt: new Date() };
  }

  /** Per-display probe (watchdog layer 2): query power for this displayId. */
  async endpointHealthCheck(endpoint: EndpointDescriptor): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.readState(endpoint);
      return { online: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (err) {
      return {
        online: false,
        details: err instanceof Error ? err.message : String(err),
        checkedAt: new Date(),
      };
    }
  }

  // ── commands ───────────────────────────────────────────────

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    _params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();

    try {
      const displayId = parseDisplayId(endpoint);

      if (this.ctx.dryRun) {
        const state = this.applyDryRun(displayId, command);
        this.ctx.logger.info("samsung-mdc dry-run command", { command, displayId });
        return { success: true, durationMs: Date.now() - start, state };
      }

      const state = await this.runCommand(displayId, command);
      this.online = true;
      this.mergeState(displayId, state);
      this.emit("state", { endpointId: endpoint.id, state, source: "echo", timestamp: new Date() });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("samsung-mdc command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  /** Encode + send one power command; return the optimistic resulting state. */
  private async runCommand(displayId: number, command: string): Promise<DisplayState> {
    switch (command) {
      case "on": {
        const response = await this.transaction(
          encodePowerSet(displayId, PowerState.ON),
          displayId,
          POWER_COMMAND,
        );
        assertAck(response);
        return { power: "on" };
      }
      case "off": {
        const response = await this.transaction(
          encodePowerSet(displayId, PowerState.OFF),
          displayId,
          POWER_COMMAND,
        );
        assertAck(response);
        return { power: "off" };
      }
      default:
        throw new Error(`unknown command: ${command}`);
    }
  }

  private applyDryRun(displayId: number, command: string): DisplayState {
    const sim = this.simState.get(displayId) ?? {};
    if (command === "on") sim.power = "on";
    else if (command === "off") sim.power = "off";
    else throw new Error(`unknown command: ${command}`);
    this.simState.set(displayId, sim);
    return { ...sim };
  }

  // ── readState ──────────────────────────────────────────────

  /** Query current power state (protocol GET: Power Control with no data). */
  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    const displayId = parseDisplayId(endpoint);
    if (this.ctx.dryRun) return { ...(this.simState.get(displayId) ?? {}) };

    const response = await this.transaction(encodePowerQuery(displayId), displayId, POWER_COMMAND);
    assertAck(response);
    const state: DisplayState = { power: decodePowerState(response.data) };
    this.mergeState(displayId, state);
    this.online = true;
    this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
    return { ...(this.stateCache.get(displayId) ?? {}) };
  }

  // ── transaction layer ──────────────────────────────────────

  /**
   * Send one MDC frame and await its response, serialised behind {@link lock}.
   * `displayId` + `command` are used to tell our response apart from a stray
   * frame (e.g. a delayed reply to a request this driver already timed out on).
   */
  private transaction(frame: Buffer, displayId: number, command: number): Promise<MdcResponse> {
    const run = this.lock.then(() => this.doTransaction(frame, displayId, command));
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private doTransaction(frame: Buffer, displayId: number, command: number): Promise<MdcResponse> {
    if (this.destroyed) return Promise.reject(new Error("driver destroyed"));
    if (!this.socket || !this.online) {
      return Promise.reject(new Error("cannot send: socket not connected"));
    }

    return new Promise<MdcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) this.pending = null;
        reject(new Error(`response timeout after ${this.responseTimeoutMs}ms`));
      }, this.responseTimeoutMs);

      this.pending = { displayId, command, resolve, reject, timer };
      this.ctx.logger.debug("samsung-mdc tx →", { host: this.host, displayId, bytes: frame.toString("hex") });
      this.socket!.write(frame);
    });
  }

  // ── socket lifecycle ───────────────────────────────────────

  private openSocket(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error("driver destroyed"));

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`connect timeout after ${this.responseTimeoutMs}ms`));
      }, this.responseTimeoutMs);

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
            this.online = true;
            this.reconnectAttempts = 0;
            this.decoder.reset();
            this.ctx.logger.debug("samsung-mdc socket open", { host: this.host, port: this.port });
            this.emit("connected");
            finish();
          },
          data: (_s, chunk) => this.onData(chunk),
          close: () => this.onClose("closed"),
          end: () => this.onClose("ended"),
          error: (_s, error) => {
            finish(error instanceof Error ? error : new Error(String(error)));
            this.onClose(`error: ${String(error)}`);
          },
          connectError: (_s, error) => {
            finish(error instanceof Error ? error : new Error(String(error)));
          },
        },
      }).catch(finish);
    });
  }

  private onData(chunk: Uint8Array): void {
    for (const response of this.decoder.push(chunk)) this.handleResponse(response);
  }

  private handleResponse(response: MdcResponse): void {
    const pending = this.pending;
    if (!pending) return; // nothing is waiting — drop it
    if (response.displayId !== pending.displayId || response.command !== pending.command) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(response);
  }

  private onClose(reason: string): void {
    if (!this.online && this.socket === null) return;
    this.online = false;
    this.socket = null;
    this.decoder.reset();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(`connection ${reason}`));
      this.pending = null;
    }
    this.emit("disconnected", reason);
    if (!this.destroyed) this.scheduleReconnect();
  }

  /** Reconnect with exponential backoff (capped at 60 s). */
  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectMs * 2 ** (this.reconnectAttempts - 1), 60_000);
    this.ctx.logger.warn("samsung-mdc scheduling reconnect", { attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket().catch((err) => {
        this.ctx.logger.warn("samsung-mdc reconnect failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!this.destroyed) this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // ── helpers ────────────────────────────────────────────────

  private mergeState(displayId: number, patch: DisplayState): void {
    this.stateCache.set(displayId, { ...(this.stateCache.get(displayId) ?? {}), ...patch });
  }
}

// ── pure helpers ─────────────────────────────────────────────

/** Parse + validate a `samsung-mdc.display` endpoint address. */
function parseDisplayId(endpoint: EndpointDescriptor): number {
  const displayId = Number(endpoint.address.displayId);
  if (!Number.isInteger(displayId) || displayId < 1 || displayId > 255) {
    throw new Error(`invalid address: displayId must be 1..255 (got ${endpoint.address.displayId})`);
  }
  return displayId;
}

/** Throw a descriptive error on a NAK response so executeCommand reports failure. */
function assertAck(response: MdcResponse): void {
  if (response.ack) return;
  const code = response.data[0];
  const hex = code !== undefined ? `0x${code.toString(16).padStart(2, "0")}` : "unknown";
  throw new Error(`display rejected command (NAK, error code ${hex})`);
}
