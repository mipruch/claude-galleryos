/**
 * MeterService — fan-out for live BSS meter streams.
 *
 * A meter widget (a virtual `bss-soundweb.meter-widget` device) shows one bar per
 * meter. While a widget is on screen the browser sends `meter:subscribe`; when it
 * is dismounted (route change, hidden by a filter) it sends `meter:unsubscribe`.
 *
 * This service guarantees the invariant the README asks for:
 *
 *     BSS meter update ──► server ──┬─► browser A
 *                                   ├─► browser B
 *                                   └─► browser C
 *
 *   • ONE BSS subscription per physical meter, no matter how many browsers watch
 *     it (ref-counted here; the first watcher subscribes, the last unsubscribes).
 *   • Readings are forwarded ONLY to the clients that asked for that meter — they
 *     never touch the EventBus, Redis, or the global broadcast.
 *
 * Readings arrive already decoded (per object address) from the driver via
 * {@link DeviceManager.setMeterListener}; we map each one back to its meter key
 * and push it to that meter's subscribers.
 */

import type { MeterUpdate } from "@gallery/driver-core";
import type { EventBus } from "./EventBus.ts";
import type { Logger } from "../logger.ts";

/** The endpoint type whose devices are meter widgets (see the BSS manifest). */
const METER_WIDGET_TYPE = "bss-soundweb.meter-widget";
/** Default bar range when the widget doesn't override it (matches the driver). */
const DEFAULT_MIN_DB = -80;
const DEFAULT_MAX_DB = 40;
const DEFAULT_VIRTUAL_DEVICE = 3;

/** A connected browser we can push messages to (a Bun ServerWebSocket). */
export interface MeterClient {
  send(data: string): unknown;
}

/** The slice of the DeviceManager the MeterService needs (keeps it testable). */
export interface MeterDeviceSource {
  getDeviceRecord(deviceId: string): Promise<{
    connectionId: string;
    endpointType: string;
    address: Record<string, unknown>;
  }>;
  meterSubscribe(connectionId: string, address: Record<string, unknown>): void;
  meterUnsubscribe(connectionId: string, address: Record<string, unknown>): void;
}

/** One resolved meter: its driver address plus the routing key it maps to. */
interface ResolvedMeter {
  key: string;
  address: Record<string, unknown>;
}

/** Ref-counted state for one physical meter. */
interface MeterEntry {
  connectionId: string;
  address: Record<string, unknown>;
  subscribers: Set<MeterClient>;
}

export interface MeterServiceOptions {
  devices: MeterDeviceSource;
  eventBus: EventBus;
  logger: Logger;
}

export class MeterService {
  private readonly devices: MeterDeviceSource;
  private readonly log: Logger;
  /** Physical meters currently subscribed, keyed by {@link meterKey}. */
  private readonly meters = new Map<string, MeterEntry>();
  /** Reverse index: which meter keys each client watches (for clean teardown). */
  private readonly byClient = new Map<MeterClient, Set<string>>();

  constructor(opts: MeterServiceOptions) {
    this.devices = opts.devices;
    this.log = opts.logger.child("meters");

    // A driver subprocess restart wipes the driver's own meter subscriptions, so
    // re-arm every active meter whenever its connection (re)connects. The driver
    // de-dupes, so this is safe even when nothing was lost.
    opts.eventBus.on("connection.connected", ({ connectionId }) => {
      for (const entry of this.meters.values()) {
        if (entry.connectionId === connectionId) {
          this.devices.meterSubscribe(connectionId, entry.address);
        }
      }
    });
  }

  /** Wire to a DeviceManager so its meter readings flow here. */
  handleMeterUpdate = (connectionId: string, update: MeterUpdate): void => {
    const a = update.address;
    const key = meterKey(
      connectionId,
      Number(a.node),
      vdOf(a.virtualDevice),
      Number(a.object),
      paramOf(a.param),
    );
    const entry = this.meters.get(key);
    if (!entry) return; // nobody is watching this meter anymore

    const message = JSON.stringify({
      event: "meter:update",
      data: {
        node: Number(a.node),
        virtualDevice: vdOf(a.virtualDevice),
        object: Number(a.object),
        param: paramOf(a.param),
        level: update.level,
        db: update.value / 10000,
      },
    });
    for (const client of entry.subscribers) {
      try {
        client.send(message);
      } catch (err) {
        this.log.debug("meter send failed", { error: String(err) });
      }
    }
  };

  /** A client's widget mounted: ref-count + subscribe each of its meters. */
  async subscribe(client: MeterClient, deviceId: string): Promise<void> {
    const meters = await this.resolveMeters(deviceId);
    if (!meters) return;

    let keys = this.byClient.get(client);
    if (!keys) this.byClient.set(client, (keys = new Set()));

    for (const meter of meters) {
      let entry = this.meters.get(meter.key);
      if (!entry) {
        entry = { connectionId: meter.connectionId, address: meter.address, subscribers: new Set() };
        this.meters.set(meter.key, entry);
      }
      const first = entry.subscribers.size === 0;
      entry.subscribers.add(client);
      keys.add(meter.key);
      if (first) {
        this.log.debug("first watcher → BSS subscribe", { key: meter.key });
        this.devices.meterSubscribe(entry.connectionId, entry.address);
      }
    }
  }

  /** A client's widget dismounted: release its meters (last one unsubscribes). */
  async unsubscribe(client: MeterClient, deviceId: string): Promise<void> {
    const meters = await this.resolveMeters(deviceId);
    if (!meters) return;
    const keys = this.byClient.get(client);
    for (const meter of meters) this.release(client, meter.key, keys);
  }

  /** A client disconnected: release everything it was watching. */
  disconnect(client: MeterClient): void {
    const keys = this.byClient.get(client);
    if (!keys) return;
    for (const key of [...keys]) this.release(client, key, keys);
    this.byClient.delete(client);
  }

  // ── internals ──────────────────────────────────────────────

  /** Remove one client from one meter; unsubscribe the meter if it's now idle. */
  private release(client: MeterClient, key: string, keys: Set<string> | undefined): void {
    keys?.delete(key);
    const entry = this.meters.get(key);
    if (!entry) return;
    entry.subscribers.delete(client);
    if (entry.subscribers.size === 0) {
      this.meters.delete(key);
      this.log.debug("last watcher → BSS unsubscribe", { key });
      this.devices.meterUnsubscribe(entry.connectionId, entry.address);
    }
  }

  /** Resolve a widget device id into its list of meters (null if not a widget). */
  private async resolveMeters(
    deviceId: string,
  ): Promise<(ResolvedMeter & { connectionId: string })[] | null> {
    let device;
    try {
      device = await this.devices.getDeviceRecord(deviceId);
    } catch (err) {
      this.log.warn("meter subscribe: unknown device", { deviceId, error: String(err) });
      return null;
    }
    if (device.endpointType !== METER_WIDGET_TYPE) {
      this.log.warn("meter subscribe: not a meter widget", { deviceId, type: device.endpointType });
      return null;
    }
    return buildMeters(device.connectionId, device.address);
  }
}

// ── pure helpers ─────────────────────────────────────────────

function vdOf(v: unknown): number {
  return Number.isInteger(Number(v)) ? Number(v) : DEFAULT_VIRTUAL_DEVICE;
}
function paramOf(v: unknown): number {
  return Number.isInteger(Number(v)) ? Number(v) : 0;
}

/** Stable routing key for one physical meter under a connection. */
function meterKey(connectionId: string, node: number, vd: number, object: number, param: number): string {
  return `${connectionId}:${node}:${vd}:${object}:${param}`;
}

/**
 * Turn a meter-widget address into the per-meter driver addresses + routing keys.
 * Invalid meters (non-integer object) are skipped — the device address schema is
 * validated on create, so this is just belt-and-braces.
 */
function buildMeters(
  connectionId: string,
  address: Record<string, unknown>,
): (ResolvedMeter & { connectionId: string })[] {
  const node = Number(address.node);
  const vd = vdOf(address.virtualDevice);
  const minDb = Number.isFinite(Number(address.minDb)) ? Number(address.minDb) : DEFAULT_MIN_DB;
  const maxDb = Number.isFinite(Number(address.maxDb)) ? Number(address.maxDb) : DEFAULT_MAX_DB;
  const list = Array.isArray(address.meters) ? (address.meters as Record<string, unknown>[]) : [];

  const out: (ResolvedMeter & { connectionId: string })[] = [];
  for (const m of list) {
    const object = Number(m.object);
    if (!Number.isInteger(object)) continue;
    const param = paramOf(m.param);
    out.push({
      connectionId,
      key: meterKey(connectionId, node, vd, object, param),
      address: { node, virtualDevice: vd, object, param, minDb, maxDb },
    });
  }
  return out;
}
