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
 *
 * `switchable` and `dimmable` are independent gateway features — setting
 * `dimmable` while `switchable` is off has no visible effect (the gateway
 * itself reports `dimmable.status: 0` whenever a fixture is switched off; see
 * `withPreservedBrightness`). So `setBrightness` while off never reaches the
 * gateway at all — it only remembers the desired level via the per-connection
 * KV store (`ctx.storage`), and `on` restores it. This is entirely this
 * driver's own business: the core and UI never see `switchable`/`dimmable`,
 * only the generic `power`/`brightness` state and `on`/`off`/`setBrightness`
 * commands — see `executeCommand`/`plan`.
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

  /**
   * Execute a command. `plan()` decides what to send and what the resulting
   * state is; whether that send actually reaches the gateway is gated on two
   * independent things — `ctx.dryRun` (never touch hardware) and, for
   * `setBrightness` alone, the fixture's last known power state (skip when
   * off — see `plan`). Either way `ctx.storage` (this driver's own KV store)
   * always gets updated so a later `on` restores the right level.
   *
   * Only `on`/`off` update the *gating* flag (`recallPower`), never
   * `setBrightness` — even though the gateway itself derives `switchable` from
   * `dimmable` (see `plan`), so a live `setBrightness` down to exactly 0 does
   * report `power: false` in its echo. Gating on that too would deadlock a
   * fader dragged through zero and back up: without an explicit `on` in
   * between, every commit past that point would wrongly skip sending. Gating
   * is only ever meant to guard the *deliberately switched off* case.
   */
  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();
    const deviceId = this.deviceId(endpoint);

    try {
      const isOn = (await this.recallPower(endpoint.id)) ?? true;
      const remembered = await this.recallBrightness(endpoint.id);
      const { control, state, skipSend } = this.plan(command, params, isOn, remembered);

      if (!skipSend && !this.ctx.dryRun) {
        await this.api("POST", `/device/${deviceId}/control`, control);
        this.online = true;
      }

      // `state` is undefined for stateless commands (e.g. scene recall).
      if (state) {
        await this.remember(endpoint.id, command, state);
        this.emit("state", { endpointId: endpoint.id, state, source: "echo", timestamp: new Date() });
      }
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("dali-lunatone command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  /** Persist what `plan()`'s state implies is now true — power only from an explicit `on`/`off`, brightness whenever known (see the class doc comment on why `setBrightness` never touches the gating flag). */
  private async remember(endpointId: string, command: string, state: Record<string, unknown>): Promise<void> {
    if (command === "on" || command === "off") await this.rememberPower(endpointId, state.power as boolean);
    if (typeof state.brightness === "number") await this.rememberBrightness(endpointId, state.brightness);
  }

  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    const deviceId = this.deviceId(endpoint);
    if (this.ctx.dryRun) {
      return {
        power: (await this.recallPower(endpoint.id)) ?? false,
        brightness: (await this.recallBrightness(endpoint.id)) ?? 0,
      };
    }

    const device = (await this.api("GET", `/device/${deviceId}`)) as DaliDevice;
    this.online = true;
    // Deliberately does NOT sync the power-gating flag (`recallPower`) from a
    // poll — see `executeCommand`'s doc comment on why gating only ever
    // follows an explicit `on`/`off`, never an incidentally observed value.
    const state = await this.withPreservedBrightness(endpoint.id, deviceState(device));
    this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
    return state;
  }

  /**
   * The gateway reports `brightness: 0` whenever a fixture is physically off —
   * that's correct for the wire, but the UI wants the last *intended* level so
   * a fader stays put while off and turning back on restores it. A genuine 0%
   * while still on is left alone (that's a real state, not "off").
   */
  private async withPreservedBrightness(
    endpointId: string,
    state: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (typeof state.brightness === "number" && state.brightness > 0) {
      void this.rememberBrightness(endpointId, state.brightness);
      return state;
    }
    if (state.power !== false) return state;
    const remembered = await this.recallBrightness(endpointId);
    return remembered !== undefined ? { ...state, brightness: remembered } : state;
  }

  private rememberBrightness(endpointId: string, level: number): Promise<void> {
    return this.ctx.storage.set(lastBrightnessKey(endpointId), level);
  }

  private async recallBrightness(endpointId: string): Promise<number | undefined> {
    return this.ctx.storage.get<number>(lastBrightnessKey(endpointId));
  }

  private rememberPower(endpointId: string, power: boolean): Promise<void> {
    return this.ctx.storage.set(powerKey(endpointId), power);
  }

  private async recallPower(endpointId: string): Promise<boolean | undefined> {
    return this.ctx.storage.get<boolean>(powerKey(endpointId));
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

  // ── command planning ────────────────────────────────────────

  /**
   * Decide a command's ControlData body, its resulting echo state, and
   * whether the send should be skipped. `on`/`off` never touch `brightness`
   * except that `on` restores the last remembered level (when known) in the
   * same request. `setBrightness` never touches the *gating* flag a caller
   * persists (see `executeCommand`), but its echoed `power` — only when the
   * request is actually sent — does reflect `level > 0`: the gateway itself
   * derives `switchable` from `dimmable`, so that's just reporting truth a
   * touch earlier than the next poll would. Pure — callers persist to
   * `ctx.storage`.
   */
  private plan(
    command: string,
    params: Record<string, unknown>,
    isOn: boolean,
    remembered: number | undefined,
  ): { control: Record<string, unknown>; state?: Record<string, unknown>; skipSend: boolean } {
    switch (command) {
      case "on": {
        const control: Record<string, unknown> = { switchable: true };
        const state: Record<string, unknown> = { power: true };
        if (remembered !== undefined) {
          control.dimmable = Math.round(remembered * 100);
          state.brightness = remembered;
        }
        return { control, state, skipSend: false };
      }
      case "off":
        return { control: { switchable: false }, state: { power: false }, skipSend: false };
      case "setBrightness": {
        const level = clamp01(Number(params.level));
        const control = { dimmable: Math.round(level * 100) };
        // While off, the gateway ignores `dimmable` anyway (see the file header
        // doc comment) — skip the request and just remember the desired level.
        if (!isOn) return { control, state: { brightness: level }, skipSend: true };
        return { control, state: { power: level > 0, brightness: level }, skipSend: false };
      }
      case "recall": {
        const scene = Number(params.scene);
        if (!Number.isInteger(scene) || scene < 0 || scene > 15) {
          throw new Error(`invalid scene: ${params.scene} (expected 0..15)`);
        }
        // Scene levels are fixture-defined; we can't predict the resulting state.
        return { control: { scene }, skipSend: false };
      }
      default:
        throw new Error(`unknown command: ${command}`);
    }
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

/** Per-driver KV key for a fixture's last known non-zero brightness. */
function lastBrightnessKey(endpointId: string): string {
  return `lastBrightness:${endpointId}`;
}

/** Per-driver KV key for a fixture's last known power state. */
function powerKey(endpointId: string): string {
  return `power:${endpointId}`;
}
