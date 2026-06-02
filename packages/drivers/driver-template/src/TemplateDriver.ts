/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DRIVER TEMPLATE — TemplateDriver.ts                                      │
 * │                                                                           │
 * │  A minimal but FULLY WORKING driver you can run against the bundled mock  │
 * │  (`test/mock-device.ts`). It speaks a toy ASCII line protocol so you can  │
 * │  see every part of the IDeviceDriver contract wired up. Replace the       │
 * │  protocol details with your device's and you have a real driver.          │
 * │                                                                           │
 * │  Toy protocol (newline-delimited ASCII):                                  │
 * │    →  PING        ←  PONG            (reachability probe)                  │
 * │    →  PWR 1 / 0   ←  OK              (power on/off)                        │
 * │    →  PWR ?       ←  PWR=1 / PWR=0   (query power)                         │
 * │    →  LVL 0..100  ←  OK              (set level, integer percent)         │
 * │    →  LVL ?       ←  LVL=42          (query level)                        │
 * │    unknown        ←  ERR                                                   │
 * │                                                                           │
 * │  RULES FOR DRIVER AUTHORS (see README §14):                               │
 * │    • Never call process.exit(). On a fatal error, emit "error" with       │
 * │      level:"fatal" and wait for destroy().                                │
 * │    • Reconnect with backoff (the DriverHost restarts you too).            │
 * │    • Honour ctx.signal (AbortSignal) and ctx.dryRun.                      │
 * │    • Never import from the server or touch the DB/Redis directly.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { EventEmitter } from "node:events";
import {
  type CommandResult,
  type ConnectionConfig,
  type DriverContext,
  type EndpointDescriptor,
  type HealthStatus,
  type IDeviceDriver,
  TcpClient,
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";

export class TemplateDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  // ── Config captured at init() ──────────────────────────────
  private host = "";
  private port = 1234;
  private timeoutMs = 2000;

  // ── Runtime state ──────────────────────────────────────────
  private ctx!: DriverContext;
  private online = false;
  private destroyed = false;
  /** In-memory state used while ctx.dryRun is true (never touches hardware). */
  private simState: Record<string, unknown> = { power: false, level: 0 };

  /**
   * Serialises device I/O. Most AV devices handle one transaction at a time;
   * chaining onto this promise guarantees we never interleave requests.
   */
  private lock: Promise<unknown> = Promise.resolve();

  // ── Lifecycle ──────────────────────────────────────────────

  /** Called once, before connect(). Read config; DON'T open sockets yet. */
  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 1234;
    this.timeoutMs = Number(config.config.responseTimeoutMs ?? 2000);

    // TODO: read any other config.config.* values your manifest declares.

    // Honour teardown: the host aborts this signal when destroying the driver.
    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
    });
    ctx.logger.debug("template init", { host: this.host, port: this.port });
  }

  /** Open the physical link. Emit "connected" on success, "disconnected" on failure. */
  async connect(): Promise<void> {
    try {
      // TODO: replace the probe with whatever proves the device is reachable
      //       (a handshake, a status query, etc.).
      const pong = await this.transaction("PING");
      if (pong.trim() !== "PONG") throw new Error(`unexpected handshake: ${pong}`);
      this.online = true;
      this.emit("connected");
    } catch (err) {
      this.online = false;
      const reason = err instanceof Error ? err.message : String(err);
      this.emit("disconnected", reason);
      throw err;
    }
  }

  /** Close the link gracefully. Keep the object reusable (connect() may follow). */
  async disconnect(): Promise<void> {
    // TODO: close any persistent socket you hold. This template opens a
    //       short-lived socket per transaction, so there's nothing to close.
    this.online = false;
  }

  /** Release everything. The driver is unusable afterwards. */
  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  // ── Status ─────────────────────────────────────────────────

  isConnected(): boolean {
    return this.online;
  }

  /** Connection-level probe used by the watchdog (layer 1). Keep it cheap. */
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.transaction("PING");
      this.online = true;
      return { online: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (err) {
      this.online = false;
      return {
        online: false,
        details: err instanceof Error ? err.message : String(err),
        checkedAt: new Date(),
      };
    }
  }

  // OPTIONAL: implement endpointHealthCheck(endpoint) for watchdog layer 2 if a
  // single connection fans out to many endpoints that can fail independently.

  // ── Commands ───────────────────────────────────────────────

  /** Translate a high-level command into device I/O and report the result. */
  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();

    // 1) Dry-run: simulate, never touch hardware. The core sets this for scene
    //    previews. ALWAYS handle it before any socket I/O.
    if (this.ctx.dryRun) {
      const state = this.applyDryRun(command, params);
      this.ctx.logger.info("template dry-run command", { command, params });
      return { success: true, durationMs: Date.now() - start, state };
    }

    // 2) Real path: run the command, echo the new state, return the result.
    try {
      const state = await this.runCommand(command, params);
      this.online = true;
      // Echo new state so the core's live cache stays fresh between polls.
      this.emit("state", {
        endpointId: endpoint.id,
        state,
        source: "echo",
        timestamp: new Date(),
      });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("template command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  /** Read current state from the device (only if capabilities.bidirectional). */
  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    if (this.ctx.dryRun) return { ...this.simState };

    // TODO: query each piece of state your stateSchema declares.
    const [pwr, lvl] = await Promise.all([
      this.transaction("PWR ?"),
      this.transaction("LVL ?"),
    ]);
    this.online = true;
    const state = {
      power: parseValue(pwr) === "1",
      level: Number(parseValue(lvl)) / 100,
    };
    this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
    return state;
  }

  // ── command translation ────────────────────────────────────

  /** Map a command name to wire I/O. Return the resulting partial state. */
  private async runCommand(
    command: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (command) {
      case "on":
        await this.expectOk(await this.transaction("PWR 1"));
        return { power: true };
      case "off":
        await this.expectOk(await this.transaction("PWR 0"));
        return { power: false };
      case "setLevel": {
        const level = clamp01(Number(params.level));
        await this.expectOk(await this.transaction(`LVL ${Math.round(level * 100)}`));
        return { level };
      }
      // TODO: add a case per command in your manifest.
      default:
        throw new Error(`unknown command: ${command}`);
    }
  }

  /** Mirror of runCommand for dry-run: mutate simState only. */
  private applyDryRun(command: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (command) {
      case "on": this.simState.power = true; break;
      case "off": this.simState.power = false; break;
      case "setLevel": this.simState.level = clamp01(Number(params.level)); break;
    }
    return { ...this.simState };
  }

  // ── transport ──────────────────────────────────────────────

  /** Run one request/response transaction, serialised behind {@link lock}. */
  private transaction(body: string): Promise<string> {
    const run = this.lock.then(() => this.doTransaction(body));
    // Keep the chain alive whether or not this transaction succeeded.
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doTransaction(body: string): Promise<string> {
    if (this.destroyed) throw new Error("driver destroyed");

    // This template opens a short-lived socket per transaction. If your device
    // keeps a persistent connection (push protocols, keepalives), hold a single
    // TcpClient on `this` and reconnect on close instead — see driver-tcp-generic.
    const client = new TcpClient({
      hostname: this.host,
      port: this.port,
      rxDelimiter: "\n",
      txDelimiter: "\n",
      encoding: "utf-8",
      connectTimeoutMs: this.timeoutMs,
    });

    await client.connect();
    try {
      this.ctx.logger.debug("template tx →", { host: this.host, port: this.port, body });
      const response = await client.request(body, this.timeoutMs);
      this.ctx.logger.debug("template rx ←", { host: this.host, response });
      return response;
    } finally {
      client.close();
    }
  }

  /** Throw on an error response so executeCommand reports failure. */
  private async expectOk(response: string): Promise<void> {
    if (response.trim() !== "OK") throw new Error(`device rejected command: ${response.trim()}`);
  }
}

// ── pure helpers ─────────────────────────────────────────────

/** Extract the value part of a `KEY=value` response (or the trimmed line). */
function parseValue(response: string): string {
  const trimmed = response.trim();
  const eq = trimmed.indexOf("=");
  return eq === -1 ? trimmed : trimmed.slice(eq + 1);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
