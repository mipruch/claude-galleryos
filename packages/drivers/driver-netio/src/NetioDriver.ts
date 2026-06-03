/**
 * NETIO smart socket driver — JSON M2M API over HTTP.
 *
 * One connection = one NETIO device (PowerBOX, PowerPDU, PowerDIN…). All socket
 * outlets on the device share a single HTTP transport. Each outlet is a separate
 * `netio.socket` endpoint with address `{ outputId: N }`.
 *
 * Protocol:
 *   GET  /netio.json              → read-all (Agent + Outputs + optional metering)
 *   POST /netio.json  body JSON   → write one or more outputs; device returns
 *                                   the full updated state in the same format.
 *   Auth: HTTP Basic in every request header.
 *
 * State includes metering fields (load, current, energy) only when the device
 * model supports them — the driver checks for presence and never fabricates zeros.
 */

import { EventEmitter } from "node:events";
import {
  type CommandResult,
  type ConnectionConfig,
  type DriverContext,
  type EndpointDescriptor,
  type HealthStatus,
  type IDeviceDriver,
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";

// ── JSON shapes returned by the device ───────────────────────

interface NetioOutput {
  ID: number;
  Name?: string;
  State: 0 | 1;
  Action: number;
  Delay?: number;
  // metering (optional — only on supported models)
  Load?: number;
  Current?: number;
  Energy?: number;
}

interface NetioResponse {
  Agent?: {
    Model?: string;
    DeviceName?: string;
    NumOutputs?: number;
    Uptime?: number;
  };
  Outputs?: NetioOutput[];
}

// ── action codes (per protocol spec) ─────────────────────────

const Action = {
  OFF: 0,
  ON: 1,
  SHORT_OFF: 2,
  SHORT_ON: 3,
  TOGGLE: 4,
  NO_CHANGE: 5,
  IGNORE: 6,
} as const;

// ── per-outlet state (driver's in-memory cache) ───────────────

interface SocketState extends Record<string, unknown> {
  on: boolean;
  load?: number;
  current?: number;
  energy?: number;
}

export class NetioDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  // ── config captured at init() ──────────────────────────────
  private baseUrl = "";
  private authHeader = "";
  private timeoutMs = 3000;

  // ── runtime ────────────────────────────────────────────────
  private ctx!: DriverContext;
  private online = false;
  private destroyed = false;
  /** Latest state snapshot from the device, keyed by output ID. */
  private cache = new Map<number, SocketState>();
  /** Simulated state for dry-run mode, keyed by output ID. */
  private simState = new Map<number, SocketState>();

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    const port = config.port || 80;
    this.baseUrl = `http://${config.host}:${port}`;
    const username = String(config.config.username ?? "netio");
    const password = String(config.config.password ?? "netio");
    this.authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    this.timeoutMs = Number(config.config.responseTimeoutMs ?? 3000);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
    });
    ctx.logger.debug("netio init", { baseUrl: this.baseUrl });
  }

  async connect(): Promise<void> {
    if (this.ctx.dryRun) {
      this.online = true;
      this.emit("connected");
      return;
    }
    try {
      await this.getStatus(); // reachability probe
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
    // HTTP is stateless — nothing to tear down.
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return this.online;
  }

  /** Connection-level health: a GET /netio.json that returns 200. */
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.getStatus();
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

  /**
   * Per-endpoint health: verify the outputId is present in the device response.
   * Re-uses the connection-level fetch and checks the Outputs array.
   */
  async endpointHealthCheck(endpoint: EndpointDescriptor): Promise<HealthStatus> {
    const start = Date.now();
    const outputId = parseOutputId(endpoint);
    try {
      const status = await this.getStatus();
      const found = status.Outputs?.some((o) => o.ID === outputId) ?? false;
      return {
        online: found,
        latencyMs: Date.now() - start,
        details: found ? undefined : `output ${outputId} not found in device response`,
        checkedAt: new Date(),
      };
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
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();
    const outputId = parseOutputId(endpoint);

    if (this.ctx.dryRun) {
      const state = this.applyDryRun(outputId, command);
      this.ctx.logger.info("netio dry-run command", { outputId, command, params });
      return { success: true, durationMs: Date.now() - start, state };
    }

    try {
      const { action, delay } = this.resolveAction(command, params);
      const body: Record<string, unknown> = { ID: outputId, Action: action };
      if (delay !== undefined) body.Delay = delay;

      const response = await this.post({ Outputs: [body] });
      this.online = true;

      // Find the updated output in the response and extract state.
      const output = response.Outputs?.find((o) => o.ID === outputId);
      const state = output ? outputToState(output) : undefined;

      if (state) {
        this.cache.set(outputId, state);
        this.emit("state", {
          endpointId: endpoint.id,
          state,
          source: "echo",
          timestamp: new Date(),
        });
      }

      this.ctx.logger.info("netio command ok", { outputId, command, state });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("netio command failed", { outputId, command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  /** Read the current outlet state; updates the in-memory cache. */
  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    const outputId = parseOutputId(endpoint);

    if (this.ctx.dryRun) {
      return { ...(this.simState.get(outputId) ?? { on: false }) };
    }

    const response = await this.getStatus();
    this.online = true;

    const output = response.Outputs?.find((o) => o.ID === outputId);
    if (!output) {
      throw new Error(`output ${outputId} not found on device (NumOutputs=${response.Agent?.NumOutputs ?? "?"})`);
    }

    const state = outputToState(output);
    this.cache.set(outputId, state);

    this.emit("state", {
      endpointId: endpoint.id,
      state,
      source: "poll",
      timestamp: new Date(),
    });
    return state;
  }

  // ── command translation ────────────────────────────────────

  /** Map a command name to the Action code (and optional Delay) the API uses. */
  private resolveAction(
    command: string,
    params: Record<string, unknown>,
  ): { action: number; delay?: number } {
    const delay = params.delayMs !== undefined ? Number(params.delayMs) : undefined;
    switch (command) {
      case "on":       return { action: Action.ON };
      case "off":      return { action: Action.OFF };
      case "toggle":   return { action: Action.TOGGLE };
      case "shortOn":  return { action: Action.SHORT_ON, delay };
      case "shortOff": return { action: Action.SHORT_OFF, delay };
      default:         throw new Error(`unknown command: ${command}`);
    }
  }

  private applyDryRun(outputId: number, command: string): SocketState {
    const current = this.simState.get(outputId) ?? { on: false };
    const next: SocketState = { ...current };
    switch (command) {
      case "on":       next.on = true;  break;
      case "off":      next.on = false; break;
      case "toggle":   next.on = !current.on; break;
      case "shortOn":  next.on = false; break; // ends off
      case "shortOff": next.on = true;  break; // ends on
      default:         throw new Error(`unknown command: ${command}`);
    }
    this.simState.set(outputId, next);
    return next;
  }

  // ── transport ──────────────────────────────────────────────

  /** GET /netio.json — returns the full device status. */
  private async getStatus(): Promise<NetioResponse> {
    return this.request("GET", undefined);
  }

  /** POST /netio.json with a control payload; device echoes updated status. */
  private async post(body: unknown): Promise<NetioResponse> {
    return this.request("POST", body);
  }

  private async request(method: "GET" | "POST", body: unknown): Promise<NetioResponse> {
    if (this.destroyed) throw new Error("driver destroyed");

    const signal = AbortSignal.any([this.ctx.signal, AbortSignal.timeout(this.timeoutMs)]);
    this.ctx.logger.debug("netio →", { method, body });

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/netio.json`, {
        method,
        signal,
        headers: {
          Authorization: this.authHeader,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    }

    if (res.status === 401) throw new Error("authentication failed (check username/password)");
    if (res.status === 403) throw new Error("write access forbidden (enable WRITE in device settings)");
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const text = await res.text();
    this.ctx.logger.debug("netio ←", { status: res.status, body: text.slice(0, 200) });
    return JSON.parse(text) as NetioResponse;
  }
}

// ── pure helpers ─────────────────────────────────────────────

function parseOutputId(endpoint: EndpointDescriptor): number {
  const id = Number(endpoint.address.outputId);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`invalid address: outputId must be a positive integer (got ${endpoint.address.outputId})`);
  }
  return id;
}

/** Project a raw Netio output object onto our stateSchema. */
function outputToState(output: NetioOutput): SocketState {
  const state: SocketState = { on: output.State === 1 };
  // Include metering fields only when the device actually provides them.
  if (output.Load    !== undefined) state.load    = output.Load;
  if (output.Current !== undefined) state.current = output.Current;
  if (output.Energy  !== undefined) state.energy  = output.Energy;
  return state;
}
