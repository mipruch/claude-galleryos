/**
 * Extron matrix-switcher driver (SIS protocol over TCP 23).
 *
 * Target: Extron DTP CrossPoint 108 4K (10×8). One persistent socket per
 * switcher is shared by every output endpoint. The driver:
 *   - keeps the socket open and reconnects with backoff if it drops;
 *   - answers the device's `Password:` prompt on connect when a password is set;
 *   - translates `setInput` / `setVideoInput` / `setAudioInput` into SIS tie
 *     commands and confirms them against the device's echo;
 *   - parses every inbound line, so an unsolicited front-panel tie change also
 *     updates the cache and emits a `state` event (live for free, even though
 *     the manifest advertises `subscriptions: false`).
 *
 * Device I/O is serialised behind a mutex (one transaction at a time): the SIS
 * connection is a single conversation, and the responses (`Out02 In05 All`) are
 * matched to the in-flight request by output number.
 *
 * Wire grammar lives in the pure, unit-tested `sis.ts`; this file owns the
 * socket lifecycle, request/response correlation, and command translation.
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
  type ParsedResponse,
  type TieType,
  buildQueryCommand,
  buildTieCommand,
  parseResponseLine,
} from "./sis.ts";

/** Cached routing state for one output endpoint. */
type OutputState = {
  input?: number;
  audioInput?: number;
};

/** A pending request awaiting its response line, correlated by output number. */
interface Pending {
  output: number;
  /** Only resolve on a tie response of this plane (or any number/error). */
  resolve: (r: ParsedResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ExtronMatrixDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  // ── config ─────────────────────────────────────────────────
  private host = "";
  private port = 23;
  private password = "";
  private inputCount = 10;
  private outputCount = 8;
  private responseTimeoutMs = 2000;
  private reconnectMs = 2000;

  // ── runtime ────────────────────────────────────────────────
  private ctx!: DriverContext;
  private socket: Socket | null = null;
  private online = false;
  private destroyed = false;
  private authenticated = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Inbound byte buffer, split into lines on CR / LF. */
  private rxBuffer = "";
  /** The single in-flight request (SIS is one conversation at a time). */
  private pending: Pending | null = null;
  /** Serialises transactions so responses match the right request. */
  private lock: Promise<unknown> = Promise.resolve();

  /** Latest known routing per output number. */
  private readonly stateCache = new Map<number, OutputState>();
  /** Simulated routing per output number (dry-run). */
  private readonly simState = new Map<number, OutputState>();

  // ── lifecycle ──────────────────────────────────────────────

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 23;
    this.password = String(config.config.password ?? "");
    this.inputCount = Number(config.config.inputCount ?? 10);
    this.outputCount = Number(config.config.outputCount ?? 8);
    this.responseTimeoutMs = Number(config.config.responseTimeoutMs ?? 2000);
    this.reconnectMs = Number(config.config.reconnectMs ?? 2000);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
      this.clearReconnect();
    });
    ctx.logger.debug("extron init", { host: this.host, port: this.port });
  }

  async connect(): Promise<void> {
    if (this.ctx.dryRun) {
      // No socket in dry-run; pretend we're online so scenes can preview.
      this.online = true;
      this.emit("connected");
      return;
    }
    await this.openSocket();
    // When a password is set the device sends `Password:` and only accepts
    // commands after we answer and it confirms with `Login …`. Wait for that
    // handshake (handled in handleLine) before returning so the first command
    // isn't sent — and dropped — while still unauthenticated. Best-effort: if no
    // confirmation arrives we proceed anyway (some firmware sends no banner).
    if (this.password) {
      await this.waitFor(() => this.authenticated, this.responseTimeoutMs);
      this.authenticated = true;
    }
  }

  /** Poll a predicate until true, the driver dies, or the timeout elapses. */
  private async waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (this.destroyed || !this.online) return;
      if (Date.now() - start > timeoutMs) return;
      await Bun.sleep(10);
    }
  }

  async disconnect(): Promise<void> {
    this.clearReconnect();
    this.online = false;
    this.authenticated = false;
    const sock = this.socket;
    this.socket = null;
    this.rxBuffer = "";
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

  /** All outputs share one socket, so endpoint health mirrors connection health. */
  async endpointHealthCheck(_endpoint: EndpointDescriptor): Promise<HealthStatus> {
    return { online: this.online, checkedAt: new Date() };
  }

  // ── commands ───────────────────────────────────────────────

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();

    if (this.ctx.dryRun) {
      const state = this.applyDryRun(endpoint, command, params);
      this.ctx.logger.info("extron dry-run command", { command, params });
      return { success: true, durationMs: Date.now() - start, state };
    }

    try {
      const output = parseOutput(endpoint, this.outputCount);
      const state = await this.runCommand(output, command, params);
      this.online = true;
      this.mergeState(output, state);
      this.emit("state", { endpointId: endpoint.id, state, source: "echo", timestamp: new Date() });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("extron command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  /** Tie type per command, or undefined for a non-tie command. */
  private static readonly TIE_BY_COMMAND: Record<string, TieType> = {
    setInput: "av",
    setVideoInput: "video",
    setAudioInput: "audio",
  };

  /** Encode + send one tie command, confirm the echo, return the new state. */
  private async runCommand(
    output: number,
    command: string,
    params: Record<string, unknown>,
  ): Promise<OutputState> {
    const type = ExtronMatrixDriver.TIE_BY_COMMAND[command];
    if (!type) throw new Error(`unknown command: ${command}`);

    const input = Number(params.input);
    if (!Number.isInteger(input) || input < 0 || input > this.inputCount) {
      throw new Error(`invalid input: expected 0..${this.inputCount} (got ${params.input})`);
    }

    const response = await this.transaction(buildTieCommand(input, output, type), output);
    if (response.kind === "error") throw new Error(`${response.code}: ${response.message}`);

    // Trust the device's echoed input when present; fall back to what we sent.
    const tied = response.kind === "tie" ? response.input : input;
    return type === "audio" ? { audioInput: tied } : { input: tied };
  }

  private applyDryRun(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): OutputState {
    const output = parseOutput(endpoint, this.outputCount);
    const type = ExtronMatrixDriver.TIE_BY_COMMAND[command];
    if (!type) throw new Error(`unknown command: ${command}`);
    const sim = this.simState.get(output) ?? {};
    const input = Number(params.input);
    if (type === "audio") sim.audioInput = input;
    else sim.input = input;
    this.simState.set(output, sim);
    return { ...sim };
  }

  // ── readState ──────────────────────────────────────────────

  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    if (this.ctx.dryRun) return { ...(this.simState.get(parseOutput(endpoint, this.outputCount)) ?? {}) };

    const output = parseOutput(endpoint, this.outputCount);
    const input = await this.queryInput(output, "video");
    const audioInput = await this.queryInput(output, "audio");

    const state: OutputState = { input };
    if (audioInput !== undefined) state.audioInput = audioInput;
    this.mergeState(output, state);
    this.online = true;
    this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
    return { ...(this.stateCache.get(output) ?? {}) };
  }

  /** Query the input tied to an output on one plane; undefined if unanswered. */
  private async queryInput(output: number, type: TieType): Promise<number | undefined> {
    const response = await this.transaction(buildQueryCommand(output, type), output);
    if (response.kind === "tie") return response.input;
    if (response.kind === "number") return response.value;
    if (response.kind === "error") {
      throw new Error(`${response.code}: ${response.message}`);
    }
    return undefined;
  }

  // ── transaction layer ──────────────────────────────────────

  /**
   * Send one SIS line and await its response, serialised behind {@link lock}.
   * `output` is the output number the response is expected to reference, used to
   * tell our response apart from an unsolicited tie change on another output.
   */
  private transaction(line: string, output: number): Promise<ParsedResponse> {
    const run = this.lock.then(() => this.doTransaction(line, output));
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private doTransaction(line: string, output: number): Promise<ParsedResponse> {
    if (this.destroyed) return Promise.reject(new Error("driver destroyed"));
    if (!this.socket || !this.online) {
      return Promise.reject(new Error("cannot send: socket not connected"));
    }

    return new Promise<ParsedResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) this.pending = null;
        reject(new Error(`response timeout after ${this.responseTimeoutMs}ms`));
      }, this.responseTimeoutMs);

      this.pending = { output, resolve, reject, timer };
      this.ctx.logger.debug("extron tx →", { host: this.host, line });
      this.socket!.write(line + "\r");
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
            this.authenticated = !this.password; // no password ⇒ already "in"
            this.reconnectAttempts = 0;
            this.rxBuffer = "";
            this.ctx.logger.debug("extron socket open", { host: this.host, port: this.port });
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
    this.rxBuffer += Buffer.from(chunk).toString("latin1");
    // SIS frames its responses with CR and/or LF; split on either, drop blanks.
    const parts = this.rxBuffer.split(/\r\n|\r|\n/);
    this.rxBuffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.length === 0) continue;
      this.handleLine(part);
    }
  }

  private handleLine(line: string): void {
    const parsed = parseResponseLine(line);
    this.ctx.logger.debug("extron rx ←", { host: this.host, line });

    // Auth handshake: answer the password prompt; note the login confirmation.
    if (parsed.kind === "info") {
      if (parsed.tag === "password" && this.password && !this.authenticated) {
        this.socket?.write(this.password + "\r");
      } else if (parsed.tag === "login") {
        this.authenticated = true;
      }
      return;
    }

    // A tie line always reflects current hardware — refresh the cache, whether it
    // answers our request or is an unsolicited front-panel change. The `state`
    // event (which needs the endpoint id) is emitted by executeCommand/readState,
    // which hold the descriptor; a spontaneous change surfaces on the next poll.
    if (parsed.kind === "tie") {
      const patch: OutputState =
        parsed.type === "audio" ? { audioInput: parsed.input } : { input: parsed.input };
      this.mergeState(parsed.output, patch);
    }

    // Resolve the in-flight request if this line answers it.
    const pending = this.pending;
    if (!pending) return;
    if (parsed.kind === "error" || parsed.kind === "number") {
      this.settlePending(parsed);
    } else if (parsed.kind === "tie" && parsed.output === pending.output) {
      this.settlePending(parsed);
    }
  }

  private settlePending(parsed: ParsedResponse): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(parsed);
  }

  private onClose(reason: string): void {
    if (!this.online && this.socket === null) return;
    this.online = false;
    this.authenticated = false;
    this.socket = null;
    this.rxBuffer = "";
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
    this.ctx.logger.warn("extron scheduling reconnect", { attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket().catch((err) => {
        this.ctx.logger.warn("extron reconnect failed", {
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

  private mergeState(output: number, patch: OutputState): void {
    this.stateCache.set(output, { ...(this.stateCache.get(output) ?? {}), ...patch });
  }
}

// ── pure helpers ─────────────────────────────────────────────

/** Parse + validate an `extron-matrix.output` endpoint address. */
function parseOutput(endpoint: EndpointDescriptor, outputCount: number): number {
  const output = Number(endpoint.address.output);
  if (!Number.isInteger(output) || output < 1 || output > outputCount) {
    throw new Error(`invalid address: output must be 1..${outputCount} (got ${endpoint.address.output})`);
  }
  return output;
}
