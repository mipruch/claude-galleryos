/**
 * Lunatone DALI-2 IoT gateway driver.
 *
 * Protocol: HTTP REST + JSON (Bun-native `fetch`), no authentication. Endpoints
 * used (base `http://<host>:<port>`):
 *  - `GET  /info`                  — reachability / health probe (device info).
 *  - `GET  /devices`               — list registered fixtures + their state.
 *  - `GET  /device/{id}`           — single fixture's current state.
 *  - `POST /device/{id}/control`   — apply a ControlData object to one fixture.
 *  - `POST /dali/scan`             — start a bus scan (discovery).
 *  - `GET  /dali/scan`             — poll scan progress.
 *
 * ControlData maps a feature name to a value, e.g. `{ "switchable": true }`,
 * `{ "dimmable": 50 }` (percent 0..100), `{ "scene": 4 }`.
 *
 * Fixtures are addressed by the gateway's *identifying number* (`deviceId`),
 * which is assigned during a scan and differs from the DALI short address.
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

/** A fixture as returned by `GET /devices` / `GET /device/{id}`. */
interface DaliDevice {
  id: number;
  name?: string;
  address?: number;
  line?: number;
  type?: string;
  features?: {
    switchable?: { status?: boolean };
    dimmable?: { status?: number };
  };
}

interface ScanModel {
  id: string;
  progress: number;
  found: number;
  status: string;
}

export class DaliLunatoneDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private baseUrl = "";
  private timeoutMs = 4000;
  private scanOnDiscover = false;

  private ctx!: DriverContext;
  private online = false;
  private destroyed = false;
  /** Per-endpoint simulated state used in dry-run mode (keyed by deviceId). */
  private simState = new Map<number, { power: boolean; brightness: number }>();

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    const port = config.port || 80;
    this.baseUrl = `http://${config.host}:${port}`;
    this.timeoutMs = Number(config.config.responseTimeoutMs ?? 4000);
    this.scanOnDiscover = Boolean(config.config.scanOnDiscover ?? false);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
    });
    ctx.logger.debug("dali-lunatone init", { baseUrl: this.baseUrl });
  }

  async connect(): Promise<void> {
    try {
      await this.api("GET", "/info"); // reachability probe
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
    // Stateless HTTP — nothing to tear down.
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
      await this.api("GET", "/info");
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
    const deviceId = this.deviceId(endpoint);

    if (this.ctx.dryRun) {
      const state = this.applyDryRun(deviceId, command, params);
      this.ctx.logger.info("dali-lunatone dry-run command", { deviceId, command, params });
      return { success: true, durationMs: Date.now() - start, state };
    }

    try {
      const { control, state } = this.translate(command, params);
      await this.api("POST", `/device/${deviceId}/control`, control);
      this.online = true;
      // `state` is undefined for stateless commands (e.g. scene recall).
      if (state) {
        this.emit("state", {
          endpointId: endpoint.id,
          state,
          source: "echo",
          timestamp: new Date(),
        });
      }
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("dali-lunatone command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    const deviceId = this.deviceId(endpoint);
    if (this.ctx.dryRun) return { ...this.ensureSim(deviceId) };

    const device = (await this.api("GET", `/device/${deviceId}`)) as DaliDevice;
    this.online = true;
    const state = deviceState(device);
    this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
    return state;
  }

  // ── discovery ──────────────────────────────────────────────

  async discoverEndpoints(): Promise<EndpointDescriptor[]> {
    if (this.scanOnDiscover) await this.runScan();

    const res = (await this.api("GET", "/devices")) as { devices?: DaliDevice[] };
    const devices = res.devices ?? [];
    return devices.map((d) => ({
      id: `dali-${d.id}`,
      type: "dali.fixture",
      address: { deviceId: d.id, ...(d.address !== undefined ? { daliAddress: d.address } : {}) },
      name: d.name ?? `DALI #${d.address ?? d.id}`,
    }));
  }

  /** Trigger a bus scan and poll until it finishes (or the driver is destroyed). */
  private async runScan(): Promise<void> {
    await this.api("POST", "/dali/scan", { newInstallation: false, noAddressing: false });
    // Scans take ~1 minute; poll progress until status leaves "in progress".
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (this.destroyed) throw new Error("driver destroyed");
      const scan = (await this.api("GET", "/dali/scan")) as ScanModel;
      this.ctx.logger.debug("dali-lunatone scan progress", { progress: scan.progress, found: scan.found });
      if (scan.status && scan.status !== "in progress") return;
      await Bun.sleep(2000);
    }
    throw new Error("dali scan timed out");
  }

  // ── command translation ────────────────────────────────────

  /** Map a command to its ControlData body and the resulting echo state. */
  private translate(
    command: string,
    params: Record<string, unknown>,
  ): { control: Record<string, unknown>; state?: Record<string, unknown> } {
    switch (command) {
      case "on":
        return { control: { switchable: true }, state: { power: true } };
      case "off":
        return { control: { switchable: false }, state: { power: false } };
      case "setBrightness": {
        const level = clamp01(Number(params.level));
        const percent = Math.round(level * 100);
        return { control: { dimmable: percent }, state: { power: percent > 0, brightness: level } };
      }
      case "recall": {
        const scene = Number(params.scene);
        if (!Number.isInteger(scene) || scene < 0 || scene > 15) {
          throw new Error(`invalid scene: ${params.scene} (expected 0..15)`);
        }
        // Scene levels are fixture-defined; we can't predict the resulting state.
        return { control: { scene } };
      }
      default:
        throw new Error(`unknown command: ${command}`);
    }
  }

  private applyDryRun(
    deviceId: number,
    command: string,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const sim = this.ensureSim(deviceId);
    switch (command) {
      case "on": sim.power = true; break;
      case "off": sim.power = false; break;
      case "setBrightness": {
        sim.brightness = clamp01(Number(params.level));
        sim.power = sim.brightness > 0;
        break;
      }
      case "recall": break; // unknown resulting level
    }
    return { ...sim };
  }

  private ensureSim(deviceId: number): { power: boolean; brightness: number } {
    let sim = this.simState.get(deviceId);
    if (!sim) {
      sim = { power: false, brightness: 0 };
      this.simState.set(deviceId, sim);
    }
    return sim;
  }

  private deviceId(endpoint: EndpointDescriptor): number {
    const id = Number(endpoint.address.deviceId);
    if (!Number.isInteger(id) || id < 0) {
      throw new Error(`invalid endpoint address: deviceId required (got ${endpoint.address.deviceId})`);
    }
    return id;
  }

  // ── transport ──────────────────────────────────────────────

  /** Perform one JSON HTTP request, honouring the timeout and abort signal. */
  private async api(method: string, path: string, body?: unknown): Promise<unknown> {
    if (this.destroyed) throw new Error("driver destroyed");

    const signal = AbortSignal.any([this.ctx.signal, AbortSignal.timeout(this.timeoutMs)]);
    this.ctx.logger.debug("dali http →", { method, path, body });
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        signal,
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`request timed out after ${this.timeoutMs}ms (${method} ${path})`);
      }
      throw err;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} (${method} ${path})`);
    }

    const text = await res.text();
    this.ctx.logger.debug("dali http ←", { status: res.status, body: text });
    return text ? JSON.parse(text) : undefined;
  }
}

// ── pure helpers ─────────────────────────────────────────────

/** Project a gateway device object onto our stateSchema. */
function deviceState(device: DaliDevice): Record<string, unknown> {
  const f = device.features ?? {};
  const state: Record<string, unknown> = {};
  if (f.switchable?.status !== undefined) state.power = Boolean(f.switchable.status);
  if (f.dimmable?.status !== undefined) state.brightness = clamp01(Number(f.dimmable.status) / 100);
  return state;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
