/**
 * BSS Soundweb London driver (London DI protocol over TCP 1023).
 *
 * One persistent socket per connection is shared by every fader endpoint. The
 * driver:
 *   - keeps the socket open and reconnects with backoff if it drops;
 *   - SUBSCRIBEs to each endpoint's gain + mute parameters so the device pushes
 *     value changes, which we route back to the owning endpoint and emit as
 *     `state` events;
 *   - re-subscribes every tracked endpoint after a reconnect;
 *   - translates `setLevel` / `setMute` commands into SET PERCENT / SET frames.
 *
 * Reads (`readState`) use SUBSCRIBE — the protocol has no GET — and return the
 * value the device pushes back (cached per endpoint).
 *
 * Binary framing is delegated to the pure `london-di.ts` codec; this file owns
 * the socket lifecycle, subscription bookkeeping, and command translation.
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
  type MeterUpdate,
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";
import {
  type DiMessage,
  type ParameterAddress,
  FrameDecoder,
  MsgType,
  decodeFrame,
  encodeAddressMessage,
  levelToPercentRaw,
  percentRawToLevel,
} from "./london-di.ts";

/** Endpoint type of the live-meter widget (not auto-subscribed like faders). */
const METER_WIDGET_TYPE = "bss-soundweb.meter-widget";

/** Parsed `bss-soundweb.fader` endpoint address. */
interface FaderAddress {
  node: number;
  virtualDevice: number;
  object: number;
  gainParam: number;
  muteParam: number;
}

/** Bookkeeping for one subscribed endpoint. */
interface Subscription {
  endpoint: EndpointDescriptor;
  addr: FaderAddress;
}

/**
 * Parsed address of one live meter. Unlike a fader this is a single read-only
 * parameter (the meter's level), driven on demand by the core's MeterService
 * rather than auto-subscribed on connect.
 */
interface MeterAddr {
  node: number;
  virtualDevice: number;
  object: number;
  param: number;
  /** dB at 0% bar height (default −80). */
  minDb: number;
  /** dB at 100% bar height (default +40). */
  maxDb: number;
}

/** Bookkeeping for one active meter subscription. */
interface MeterSub {
  addr: MeterAddr;
  /** The address echoed back on each reading so the core can route it. */
  echo: Record<string, unknown>;
}

/** Which field an inbound parameter maps to. */
type Field = "level" | "muted";

type FaderState = { level?: number; muted?: boolean };

export class BssSoundwebDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  // ── config ─────────────────────────────────────────────────
  private host = "";
  private port = 1023;
  private responseTimeoutMs = 2000;
  private reconnectMs = 2000;

  // ── runtime ────────────────────────────────────────────────
  private ctx!: DriverContext;
  private socket: Socket | null = null;
  private online = false;
  private destroyed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly decoder = new FrameDecoder();

  /** Tracked subscriptions, keyed by endpoint id (survives reconnects). */
  private readonly subs = new Map<string, Subscription>();
  /** Route inbound (node:vd:object:param) → which endpoint+field it belongs to. */
  private readonly routes = new Map<string, { endpointId: string; field: Field }>();
  /** Active meter subscriptions, keyed by route key (survives reconnects). */
  private readonly meters = new Map<string, MeterSub>();
  /** Latest known state per endpoint id (fed by subscription pushes + echoes). */
  private readonly stateCache = new Map<string, FaderState>();
  /** Per-endpoint simulated state for dry-run. */
  private readonly simState = new Map<string, FaderState>();

  // ── lifecycle ──────────────────────────────────────────────

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 1023;
    this.responseTimeoutMs = Number(config.config.responseTimeoutMs ?? 2000);
    this.reconnectMs = Number(config.config.reconnectMs ?? 2000);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
      this.clearReconnect();
    });
    ctx.logger.debug("bss init", { host: this.host, port: this.port });
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

  /**
   * Per-endpoint probe (watchdog layer 2). All endpoints share one socket, so
   * endpoint health mirrors connection health — kept cheap (no extra traffic).
   */
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
      const state = this.applyDryRun(endpoint.id, command, params);
      this.ctx.logger.info("bss dry-run command", { command, params });
      return { success: true, durationMs: Date.now() - start, state };
    }

    try {
      const addr = parseAddress(endpoint);
      const state = this.runCommand(addr, command, params);
      this.mergeState(endpoint.id, state);
      this.emit("state", { endpointId: endpoint.id, state, source: "echo", timestamp: new Date() });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("bss command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  /** Encode + send one command; return the optimistic resulting state. */
  private runCommand(
    addr: FaderAddress,
    command: string,
    params: Record<string, unknown>,
  ): FaderState {
    switch (command) {
      case "setLevel": {
        if (isNaN(Number(params.level))) {
          throw new Error(`invalid level: expected a number (got ${params.level})`);
        }
        const level = clamp01(Number(params.level));
        this.send(
          encodeAddressMessage(MsgType.SET_PERCENT, paramAddr(addr, addr.gainParam), levelToPercentRaw(level)),
        );
        return { level };
      }
      case "setMute": {
        if (typeof params.muted !== "boolean") {
          throw new Error(`invalid muted: expected a boolean (got ${params.muted})`);
        }
        const muted = Boolean(params.muted);
        this.send(encodeAddressMessage(MsgType.SET, paramAddr(addr, addr.muteParam), muted ? 1 : 0));
        return { muted };
      }
      default:
        throw new Error(`unknown command: ${command}`);
    }
  }

  private applyDryRun(
    id: string,
    command: string,
    params: Record<string, unknown>,
  ): FaderState {
    const sim = this.simState.get(id) ?? {};
    if (command === "setLevel") sim.level = clamp01(Number(params.level));
    else if (command === "setMute") sim.muted = Boolean(params.muted);
    else throw new Error(`unknown command: ${command}`);
    this.simState.set(id, sim);
    return { ...sim };
  }

  // ── readState ──────────────────────────────────────────────

  /**
   * Read current values. The protocol has no GET, so we ensure a subscription
   * (which makes the device push the current value) and return the cached
   * result. Already-subscribed endpoints return their freshest cached state.
   */
  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    if (this.ctx.dryRun) return { ...(this.simState.get(endpoint.id) ?? {}) };

    await this.subscribeToEndpoint(endpoint);
    // Give the device a moment to push both values back after SUBSCRIBE.
    await this.waitFor(() => {
      const s = this.stateCache.get(endpoint.id);
      return s !== undefined && s.level !== undefined && s.muted !== undefined;
    }, this.responseTimeoutMs);

    const state = { ...(this.stateCache.get(endpoint.id) ?? {}) };
    this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
    return state;
  }

  // ── subscriptions ──────────────────────────────────────────

  async subscribeToEndpoint(endpoint: EndpointDescriptor): Promise<void> {
    // Meter widgets carry no fader address and are driven on demand via
    // subscribeMeter — skip them in the auto-subscribe-on-connect sweep.
    if (endpoint.type === METER_WIDGET_TYPE) return;
    const addr = parseAddress(endpoint);
    this.subs.set(endpoint.id, { endpoint, addr });
    this.routes.set(routeKey(addr.node, addr.virtualDevice, addr.object, addr.gainParam), {
      endpointId: endpoint.id,
      field: "level",
    });
    this.routes.set(routeKey(addr.node, addr.virtualDevice, addr.object, addr.muteParam), {
      endpointId: endpoint.id,
      field: "muted",
    });
    if (this.online) this.sendSubscribe(addr);
  }

  async unsubscribeFromEndpoint(endpoint: EndpointDescriptor): Promise<void> {
    if (endpoint.type === METER_WIDGET_TYPE) return;
    const sub = this.subs.get(endpoint.id);
    if (!sub) return;
    const { addr } = sub;
    if (this.online) {
      this.send(encodeAddressMessage(MsgType.UNSUBSCRIBE_PERCENT, paramAddr(addr, addr.gainParam)));
      this.send(encodeAddressMessage(MsgType.UNSUBSCRIBE, paramAddr(addr, addr.muteParam)));
    }
    this.subs.delete(endpoint.id);
    this.routes.delete(routeKey(addr.node, addr.virtualDevice, addr.object, addr.gainParam));
    this.routes.delete(routeKey(addr.node, addr.virtualDevice, addr.object, addr.muteParam));
  }

  /** SUBSCRIBE (percent for gain, raw for mute) for one fader. */
  private sendSubscribe(addr: FaderAddress): void {
    this.send(encodeAddressMessage(MsgType.SUBSCRIBE_PERCENT, paramAddr(addr, addr.gainParam)));
    this.send(encodeAddressMessage(MsgType.SUBSCRIBE, paramAddr(addr, addr.muteParam)));
  }

  /** Re-subscribe every tracked endpoint + meter (after a reconnect). */
  private resubscribeAll(): void {
    for (const { addr } of this.subs.values()) this.sendSubscribe(addr);
    for (const { addr } of this.meters.values()) {
      this.send(encodeAddressMessage(MsgType.SUBSCRIBE, meterParamAddr(addr)));
    }
  }

  // ── meters (live, push-only) ───────────────────────────────

  /**
   * Begin streaming one meter parameter. The device immediately returns the
   * current value as a SET, then on every change (London DI manual, §SUBSCRIBE).
   * Idempotent — re-subscribing the same meter just refreshes the bookkeeping and
   * re-sends a SUBSCRIBE (harmless; the device coalesces it).
   */
  async subscribeMeter(address: Record<string, unknown>): Promise<void> {
    if (this.ctx.dryRun) return;
    const addr = parseMeterAddress(address);
    const key = routeKey(addr.node, addr.virtualDevice, addr.object, addr.param);
    this.meters.set(key, {
      addr,
      echo: { node: addr.node, virtualDevice: addr.virtualDevice, object: addr.object, param: addr.param },
    });
    if (this.online) this.send(encodeAddressMessage(MsgType.SUBSCRIBE, meterParamAddr(addr)));
  }

  /** Stop streaming a meter parameter. */
  async unsubscribeMeter(address: Record<string, unknown>): Promise<void> {
    if (this.ctx.dryRun) return;
    const addr = parseMeterAddress(address);
    const key = routeKey(addr.node, addr.virtualDevice, addr.object, addr.param);
    if (!this.meters.delete(key)) return;
    if (this.online) this.send(encodeAddressMessage(MsgType.UNSUBSCRIBE, meterParamAddr(addr)));
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
            this.ctx.logger.debug("bss socket open", { host: this.host, port: this.port });
            this.emit("connected");
            this.resubscribeAll();
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
    for (const inner of this.decoder.push(chunk)) {
      let msg: DiMessage | null;
      try {
        msg = decodeFrame(inner);
      } catch (err) {
        this.ctx.logger.warn("bss frame decode error", {
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (msg) this.routeInbound(msg);
    }
  }

  /** Map an inbound SET / SET_PERCENT to its endpoint (or meter) and route it. */
  private routeInbound(msg: DiMessage): void {
    const key = routeKey(msg.node, msg.virtualDevice, msg.object, msg.param);

    // Meters first: a meter is a separate, push-only channel (no Redis state).
    const meter = this.meters.get(key);
    if (meter) {
      this.emit("meter", meterUpdateOf(meter, msg.value) satisfies MeterUpdate);
      return;
    }

    const route = this.routes.get(key);
    if (!route) return; // not a parameter we track

    const patch: FaderState =
      route.field === "level"
        ? { level: percentRawToLevel(msg.value) }
        : { muted: msg.value !== 0 };

    this.mergeState(route.endpointId, patch);
    this.emit("state", {
      endpointId: route.endpointId,
      state: patch,
      source: "subscription",
      timestamp: new Date(),
    });
  }

  private onClose(reason: string): void {
    if (!this.online && this.socket === null) return;
    this.online = false;
    this.socket = null;
    this.decoder.reset();
    this.emit("disconnected", reason);
    if (!this.destroyed) this.scheduleReconnect();
  }

  /** Reconnect with exponential backoff (capped), preserving subscriptions. */
  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectMs * 2 ** (this.reconnectAttempts - 1), 60_000);
    this.ctx.logger.warn("bss scheduling reconnect", { attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket().catch((err) => {
        this.ctx.logger.warn("bss reconnect failed", {
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

  private send(frame: Buffer): void {
    if (!this.socket || !this.online) throw new Error("cannot send: socket not connected");
    this.ctx.logger.debug("bss tx →", { bytes: frame.toString("hex") });
    this.socket.write(frame);
  }

  private mergeState(id: string, patch: FaderState): void {
    this.stateCache.set(id, { ...(this.stateCache.get(id) ?? {}), ...patch });
  }

  /** Poll a predicate until true or timeout (used to await subscription pushes). */
  private async waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (this.destroyed) return;
      if (Date.now() - start > timeoutMs) return; // best-effort; return what we have
      await Bun.sleep(10);
    }
  }
}

// ── pure helpers ─────────────────────────────────────────────

/** Parse + validate a `bss-soundweb.fader` endpoint address. */
function parseAddress(endpoint: EndpointDescriptor): FaderAddress {
  const a = endpoint.address;
  const node = Number(a.node);
  const object = Number(a.object);
  if (!Number.isInteger(node) || node < 1 || node > 65534) {
    throw new Error(`invalid address: node must be 1..65534 (got ${a.node})`);
  }
  if (!Number.isInteger(object) || object < 0 || object > 0xffffff) {
    throw new Error(`invalid address: object must be 0..16777215 (got ${a.object})`);
  }
  return {
    node,
    object,
    virtualDevice: Number.isInteger(Number(a.virtualDevice)) ? Number(a.virtualDevice) : 3,
    gainParam: Number.isInteger(Number(a.gainParam)) ? Number(a.gainParam) : 0,
    muteParam: Number.isInteger(Number(a.muteParam)) ? Number(a.muteParam) : 1,
  };
}

/** Build a ParameterAddress for a specific parameter id within a fader. */
function paramAddr(addr: FaderAddress, param: number): ParameterAddress {
  return { node: addr.node, virtualDevice: addr.virtualDevice, object: addr.object, param };
}

/** Parse + validate one meter address (a single read-only parameter). */
function parseMeterAddress(a: Record<string, unknown>): MeterAddr {
  const node = Number(a.node);
  const object = Number(a.object);
  if (!Number.isInteger(node) || node < 1 || node > 65534) {
    throw new Error(`invalid meter address: node must be 1..65534 (got ${a.node})`);
  }
  if (!Number.isInteger(object) || object < 0 || object > 0xffffff) {
    throw new Error(`invalid meter address: object must be 0..16777215 (got ${a.object})`);
  }
  const minDb = Number.isFinite(Number(a.minDb)) ? Number(a.minDb) : -80;
  const maxDb = Number.isFinite(Number(a.maxDb)) ? Number(a.maxDb) : 40;
  return {
    node,
    object,
    virtualDevice: Number.isInteger(Number(a.virtualDevice)) ? Number(a.virtualDevice) : 3,
    param: Number.isInteger(Number(a.param)) ? Number(a.param) : 0,
    minDb,
    maxDb: maxDb > minDb ? maxDb : minDb + 1, // guard against a zero/negative span
  };
}

/** Build the ParameterAddress for a meter's single value parameter. */
function meterParamAddr(addr: MeterAddr): ParameterAddress {
  return { node: addr.node, virtualDevice: addr.virtualDevice, object: addr.object, param: addr.param };
}

/**
 * Convert a raw meter value into a {@link MeterUpdate}. The London DI meter value
 * is dB × 10000; we map [minDb, maxDb] onto a 0..1 bar level (see the worked
 * example in `manuals/bss-meter-subscribe-example.js`).
 */
function meterUpdateOf(meter: MeterSub, value: number): MeterUpdate {
  const { addr, echo } = meter;
  const db = value / 10000;
  const level = clamp01((db - addr.minDb) / (addr.maxDb - addr.minDb));
  return { address: echo, value, level };
}

function routeKey(node: number, vd: number, object: number, param: number): string {
  return `${node}:${vd}:${object}:${param}`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
