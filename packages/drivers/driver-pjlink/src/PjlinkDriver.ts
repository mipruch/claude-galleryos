/**
 * PJLink Class 1 projector driver.
 *
 * Protocol summary (PJLink Class 1, TCP/4352, ASCII, CR-terminated):
 *  - On connect the projector sends a banner: `PJLINK 0` (no auth) or
 *    `PJLINK 1 <8-hex-seed>` (auth required).
 *  - For auth, the client prefixes its command with `md5(seed + password)`.
 *  - Commands look like `%1POWR 1` (set) or `%1POWR ?` (query); responses look
 *    like `%1POWR=1`. Errors come back as `ERR1`..`ERR4`, auth failure as
 *    `PJLINK ERRA`.
 *  - Most projectors close the socket after each command, so this driver uses a
 *    short-lived connection per transaction and keeps a logical `online` flag.
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

/** Friendly input names → PJLink 2-digit input codes (type digit + number). */
const INPUT_ALIASES: Record<string, string> = {
  RGB1: "11", RGB2: "12",
  VIDEO1: "21", VIDEO2: "22",
  HDMI1: "31", HDMI2: "32", DIGITAL1: "31", DIGITAL2: "32",
  STORAGE1: "41",
  NETWORK1: "51",
};

/** Human-readable messages for PJLink error codes. */
const ERR_MESSAGES: Record<string, string> = {
  ERR1: "undefined command",
  ERR2: "parameter out of range",
  ERR3: "unavailable time (projector warming/cooling)",
  ERR4: "projector/display failure",
  ERRA: "authentication error (wrong or missing password)",
};

export class PjlinkDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private host = "";
  private port = 4352;
  private password = "";
  private timeoutMs = 2000;

  private ctx!: DriverContext;
  private online = false;
  private destroyed = false;
  /** In-memory state used in dry-run mode. */
  private simState: Record<string, unknown> = { power: "off", input: "31", muted: false };

  /** Serialises all device I/O — PJLink allows one transaction at a time. */
  private lock: Promise<unknown> = Promise.resolve();

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 4352;
    this.password = String(config.config.password ?? "");
    this.timeoutMs = Number(config.config.responseTimeoutMs ?? 2000);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
    });
    ctx.logger.debug("pjlink init", { host: this.host, port: this.port });
  }

  async connect(): Promise<void> {
    try {
      await this.transaction("%1POWR ?"); // reachability probe
      this.online = true;
      this.emit("connected");
    } catch (err) {
      this.online = false;
      const reason = err instanceof Error ? err.message : String(err);
      this.emit("disconnected", reason);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.online = false;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return this.online;
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.transaction("%1POWR ?");
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

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();

    if (this.ctx.dryRun) {
      const state = this.applyDryRun(command, params);
      this.ctx.logger.info("pjlink dry-run command", { command, params });
      return { success: true, durationMs: Date.now() - start, state };
    }

    try {
      const state = await this.runCommand(command, params);
      this.online = true;
      // Echo the new state so the core's live cache stays fresh.
      this.emit("state", {
        endpointId: endpoint.id,
        state,
        source: "echo",
        timestamp: new Date(),
      });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("pjlink command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    if (this.ctx.dryRun) return { ...this.simState };

    const [power, input, avmt] = await Promise.all([
      this.transaction("%1POWR ?"),
      this.transaction("%1INPT ?"),
      this.transaction("%1AVMT ?"),
    ]);
    this.online = true;
    const state = {
      power: mapPower(power),
      input,
      muted: ["31", "11", "21"].includes(avmt),
    };
    this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
    return state;
  }

  // ── command translation ────────────────────────────────────

  private async runCommand(
    command: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (command) {
      case "on":
        await this.transaction("%1POWR 1");
        return { power: "on" };
      case "off":
        await this.transaction("%1POWR 0");
        return { power: "off" };
      case "setInput": {
        const code = resolveInput(String(params.input ?? ""));
        await this.transaction(`%1INPT ${code}`);
        return { input: code };
      }
      case "setMute": {
        const muted = Boolean(params.muted);
        await this.transaction(`%1AVMT ${muted ? "31" : "30"}`);
        return { muted };
      }
      default:
        throw new Error(`unknown command: ${command}`);
    }
  }

  private applyDryRun(command: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (command) {
      case "on": this.simState.power = "on"; break;
      case "off": this.simState.power = "off"; break;
      case "setInput": this.simState.input = resolveInput(String(params.input ?? "")); break;
      case "setMute": this.simState.muted = Boolean(params.muted); break;
    }
    return { ...this.simState };
  }

  // ── transport ──────────────────────────────────────────────

  /**
   * Run one PJLink transaction over a short-lived connection: open, read the
   * auth banner, send the (optionally digested) command, return the value part
   * of the response. Serialised behind {@link lock}.
   */
  private transaction(body: string): Promise<string> {
    const run = this.lock.then(() => this.doTransaction(body));
    // Keep the chain alive regardless of success/failure.
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doTransaction(body: string): Promise<string> {
    if (this.destroyed) throw new Error("driver destroyed");

    const client = new TcpClient({
      hostname: this.host,
      port: this.port,
      rxDelimiter: "\r",
      txDelimiter: "\r",
      encoding: "latin1",
      connectTimeoutMs: this.timeoutMs,
    });

    await client.connect();
    try {
      const banner = await client.receive(this.timeoutMs);
      const prefix = this.authPrefix(banner);
      // Log the raw protocol message sent to the physical device.
      this.ctx.logger.debug("pjlink tx →", { host: this.host, port: this.port, body });
      const response = await client.request(prefix + body, this.timeoutMs);
      this.ctx.logger.debug("pjlink rx ←", { host: this.host, response });
      return parseResponse(response);
    } finally {
      client.close();
    }
  }

  /** Compute the auth digest prefix from the projector's banner line. */
  private authPrefix(banner: string): string {
    const trimmed = banner.trim();
    if (trimmed.startsWith("PJLINK 0")) return "";
    if (trimmed.startsWith("PJLINK 1")) {
      const seed = trimmed.split(/\s+/)[2] ?? "";
      if (!this.password) throw new Error("projector requires a password but none configured");
      return new Bun.CryptoHasher("md5").update(seed + this.password).digest("hex");
    }
    throw new Error(`unexpected PJLink banner: ${trimmed || "<empty>"}`);
  }
}

// ── pure helpers ─────────────────────────────────────────────

function resolveInput(input: string): string {
  const upper = input.trim().toUpperCase();
  if (INPUT_ALIASES[upper]) return INPUT_ALIASES[upper]!;
  if (/^[1-5][1-9]$/.test(upper)) return upper; // already a valid PJLink code
  throw new Error(`invalid input: ${input}`);
}

function mapPower(code: string): string {
  switch (code) {
    case "0": return "off";
    case "1": return "on";
    case "2": return "cooling";
    case "3": return "warming";
    default: return "unknown";
  }
}

/** Extract the value from a PJLink response, throwing on protocol errors. */
function parseResponse(response: string): string {
  const trimmed = response.trim();
  if (trimmed === "PJLINK ERRA") throw new Error(ERR_MESSAGES.ERRA);
  const eq = trimmed.indexOf("=");
  const value = eq === -1 ? trimmed : trimmed.slice(eq + 1);
  if (ERR_MESSAGES[value]) throw new Error(`${value}: ${ERR_MESSAGES[value]}`);
  return value;
}
