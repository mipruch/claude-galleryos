/**
 * Watchdog — two-layer health monitoring for connections and endpoints.
 *
 * Layer 1 (connection health, default every 10 s):
 *   Calls healthCheck() on every running DriverHost via DeviceManager and writes
 *   the result to Redis. Emits `connection.connected` / `connection.disconnected`
 *   on the EventBus only when the online status changes.
 *
 * Layer 2 (endpoint health, default every 60 s):
 *   Calls endpointHealthCheck() for every device across all running connections.
 *   Checks are staggered evenly across the interval so all devices never probe
 *   simultaneously. Skips devices whose driver does not implement the optional
 *   endpointHealthCheck IPC call (DeviceManager returns null). Emits
 *   `device.online` / `device.offline` on status transitions.
 *
 * The Watchdog is a passive observer — it never modifies connection state itself.
 * DeviceManager reacts to the emitted EventBus events through its own wiring.
 */

import type { HealthStatus } from "@gallery/driver-core";
import { errMsg } from "@gallery/driver-core";
import type { EventBus } from "./EventBus.ts";
import type { LiveStateStore, DeviceRecord } from "./DeviceManager.ts";
import type { Logger } from "../logger.ts";

// ── target interface ─────────────────────────────────────────

/**
 * Structural interface for what the Watchdog needs from DeviceManager.
 * DeviceManager satisfies it; tests can substitute a cheap fake.
 */
export interface WatchdogTarget {
  listRunningConnectionIds(): string[];
  healthCheckConnection(connectionId: string): Promise<HealthStatus>;
  devicesForConnection(connectionId: string): DeviceRecord[];
  /** Returns null when the driver does not support endpoint health checks. */
  endpointHealthCheck(deviceId: string): Promise<HealthStatus | null>;
}

// ── options ──────────────────────────────────────────────────

export interface WatchdogOptions {
  target: WatchdogTarget;
  state: LiveStateStore;
  eventBus: EventBus;
  logger: Logger;
  /** How often to ping every connection (ms). Default: 10 000. */
  connectionIntervalMs?: number;
  /** How often to run the full endpoint sweep (ms). Default: 60 000. */
  endpointIntervalMs?: number;
}

// ── implementation ───────────────────────────────────────────

export class Watchdog {
  private connectionTimer: ReturnType<typeof setInterval> | null = null;
  private endpointTimer: ReturnType<typeof setInterval> | null = null;
  /** In-flight staggered endpoint-check timeouts, cleared on stop(). */
  private readonly endpointTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private running = false;
  private readonly log: Logger;
  private readonly connectionIntervalMs: number;
  private readonly endpointIntervalMs: number;

  constructor(private readonly opts: WatchdogOptions) {
    this.log = opts.logger.child("watchdog");
    this.connectionIntervalMs = opts.connectionIntervalMs ?? 10_000;
    this.endpointIntervalMs = opts.endpointIntervalMs ?? 60_000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.connectionTimer = setInterval(
      () => void this.checkConnections(),
      this.connectionIntervalMs,
    );

    this.endpointTimer = setInterval(
      () => this.scheduleEndpointChecks(),
      this.endpointIntervalMs,
    );

    this.log.info("Watchdog started", {
      connectionIntervalMs: this.connectionIntervalMs,
      endpointIntervalMs: this.endpointIntervalMs,
    });
  }

  stop(): void {
    if (this.connectionTimer) clearInterval(this.connectionTimer);
    if (this.endpointTimer) clearInterval(this.endpointTimer);
    for (const t of this.endpointTimeouts) clearTimeout(t);
    this.endpointTimeouts.clear();
    this.connectionTimer = null;
    this.endpointTimer = null;
    this.running = false;
    this.log.info("Watchdog stopped");
  }

  // ── Layer 1: connection health ────────────────────────────

  private async checkConnections(): Promise<void> {
    const ids = this.opts.target.listRunningConnectionIds();
    await Promise.all(ids.map((id) => this.checkOneConnection(id)));
  }

  private async checkOneConnection(connectionId: string): Promise<void> {
    let health: HealthStatus;
    try {
      health = await this.opts.target.healthCheckConnection(connectionId);
    } catch (err) {
      this.log.warn("connection health check threw", { connectionId, error: errMsg(err) });
      return;
    }

    const prev = await this.opts.state.getConnectionStatus(connectionId);

    // Always persist the freshest status.
    await this.opts.state.setConnectionStatus(connectionId, {
      online: health.online,
      latencyMs: health.latencyMs,
      lastSeen: health.checkedAt.toISOString(),
      lastError: health.online ? undefined : (health.details ?? "watchdog: no response"),
    });

    // Emit only on transitions; treat null (unknown) → online as a transition.
    const wasOnline = prev?.online ?? null;
    if (wasOnline === health.online) return;

    if (health.online) {
      this.opts.eventBus.emit({ type: "connection.connected", connectionId });
    } else {
      this.opts.eventBus.emit({
        type: "connection.disconnected",
        connectionId,
        reason: health.details ?? "watchdog: no response",
      });
    }
  }

  // ── Layer 2: endpoint health (staggered) ──────────────────

  /**
   * Spread individual endpoint checks evenly across the full interval using
   * `setTimeout` offsets so no burst of probe traffic hits the network at once.
   */
  private scheduleEndpointChecks(): void {
    const ids = this.opts.target.listRunningConnectionIds();

    const allDevices: Array<{ deviceId: string; connectionId: string }> = [];
    for (const connectionId of ids) {
      for (const device of this.opts.target.devicesForConnection(connectionId)) {
        allDevices.push({ deviceId: device.id, connectionId });
      }
    }

    if (allDevices.length === 0) return;

    // Distribute checks evenly; clamp minimum delay to 0 for a single device.
    const delayStep = this.endpointIntervalMs / allDevices.length;

    allDevices.forEach(({ deviceId, connectionId }, i) => {
      const t = setTimeout(() => {
        this.endpointTimeouts.delete(t);
        void this.checkOneEndpoint(deviceId, connectionId);
      }, Math.floor(i * delayStep));
      this.endpointTimeouts.add(t);
    });
  }

  private async checkOneEndpoint(deviceId: string, connectionId: string): Promise<void> {
    let health: HealthStatus | null;
    try {
      health = await this.opts.target.endpointHealthCheck(deviceId);
    } catch (err) {
      this.log.warn("endpoint health check threw", {
        deviceId,
        error: errMsg(err),
      });
      return;
    }

    // null means the driver doesn't implement endpointHealthCheck — skip silently.
    if (health === null) return;

    const prev = await this.opts.state.getDeviceStatus(deviceId);

    await this.opts.state.setDeviceStatus(deviceId, {
      online: health.online,
      lastSeen: health.checkedAt.toISOString(),
      lastError: health.online ? undefined : (health.details ?? "watchdog: endpoint not responding"),
    });

    const wasOnline = prev?.online ?? null;
    if (wasOnline === health.online) return;

    if (health.online) {
      this.opts.eventBus.emit({ type: "device.online", deviceId, connectionId });
    } else {
      this.opts.eventBus.emit({
        type: "device.offline",
        deviceId,
        connectionId,
        reason: health.details ?? "watchdog: endpoint not responding",
      });
    }
  }
}
