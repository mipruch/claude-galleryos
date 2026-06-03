/**
 * DeviceManager — orchestrates all communication with physical devices.
 *
 * It is the single owner of DriverHosts (one per connection). It:
 *  1. loads enabled connections + devices and starts a DriverHost per connection
 *  2. proxies `execute`/`readState` to the right host, serialised per endpoint
 *  3. mirrors live state/status into the state store (Redis) and re-emits driver
 *     events onto the EventBus (so other modules never touch DriverHost directly)
 *
 * Dependencies are injected via interfaces (`DeviceManagerRepo`,
 * `LiveStateStore`) so the manager can be tested without a real DB/Redis.
 */

import type { DriverKVStore, EndpointDescriptor } from "@gallery/driver-core";
import { DriverHost, type RestartPolicy } from "../drivers/DriverHost.ts";
import { EventBus } from "./EventBus.ts";
import type { Logger } from "../logger.ts";

// ── records & dependency contracts ───────────────────────────

/** A connection as the manager needs it (maps to ConnectionConfig). */
export interface ConnectionRecord {
  id: string;
  driverId: string;
  host: string | null;
  port: number | null;
  config: Record<string, unknown>;
}

/** A device as the manager needs it. `endpointType` is the driver endpoint type. */
export interface DeviceRecord {
  id: string;
  connectionId: string;
  name: string;
  /** Matches an EndpointTypeDefinition.type, e.g. `pjlink.projector`. */
  endpointType: string;
  address: Record<string, unknown>;
}

/** Data source for connections and devices (DB-backed in production). */
export interface DeviceManagerRepo {
  listEnabledConnections(): Promise<ConnectionRecord[]>;
  listDevicesByConnection(connectionId: string): Promise<DeviceRecord[]>;
  getDevice(deviceId: string): Promise<DeviceRecord | undefined>;
}

export interface ConnectionStatus {
  online: boolean;
  latencyMs?: number;
  lastSeen?: string;
  lastError?: string;
}
export interface DeviceStatus {
  online: boolean;
  lastSeen?: string;
  lastError?: string;
}

/** Live, disposable state (Redis-backed in production). */
export interface LiveStateStore {
  setDeviceState(deviceId: string, state: Record<string, unknown>): Promise<void>;
  getDeviceState(deviceId: string): Promise<Record<string, unknown> | null>;
  setDeviceStatus(deviceId: string, status: DeviceStatus): Promise<void>;
  getDeviceStatus(deviceId: string): Promise<DeviceStatus | null>;
  setConnectionStatus(connectionId: string, status: ConnectionStatus): Promise<void>;
  getConnectionStatus(connectionId: string): Promise<ConnectionStatus | null>;
}

/** Snapshot of a driver host for system/diagnostics endpoints. */
export interface DriverStatus {
  connectionId: string;
  driverId: string;
  running: boolean;
  connected: boolean;
}

export interface DeviceManagerOptions {
  repo: DeviceManagerRepo;
  state: LiveStateStore;
  eventBus: EventBus;
  logger: Logger;
  /** Builds the per-connection KV store handed to each driver. */
  driverKVStore: (connectionId: string) => DriverKVStore;
  /**
   * Whether a driver supports subscriptions (its manifest's
   * `capabilities.subscriptions`). When true, the manager subscribes all of a
   * connection's endpoints once it comes online so the driver pushes state.
   * Omitted → no auto-subscribe (poll-only behaviour).
   */
  supportsSubscriptions?: (driverId: string) => boolean;
  dryRun?: boolean;
  restart?: RestartPolicy;
  commandTimeoutMs?: number;
}

// ── implementation ───────────────────────────────────────────

export class DeviceManager {
  private readonly hosts = new Map<string, DriverHost>();
  private readonly driverIds = new Map<string, string>();
  private readonly devicesByConnection = new Map<string, DeviceRecord[]>();
  private readonly deviceCache = new Map<string, DeviceRecord>();
  /** Per-endpoint command serialisation (avoids races on one device). */
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly log: Logger;

  constructor(private readonly opts: DeviceManagerOptions) {
    this.log = opts.logger.child("device_manager");
  }

  /** Load connections + devices and start a DriverHost for each connection. */
  async start(): Promise<void> {
    const connections = await this.opts.repo.listEnabledConnections();
    this.log.info(`Starting ${connections.length} connection(s)`);

    await Promise.all(connections.map((c) => this.startConnection(c)));
  }

  /** Stop all DriverHosts (graceful). */
  async stop(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((h) => h.stop()));
    this.hosts.clear();
  }

  // ── runtime connection management (driven by the API) ──────

  /** Start (or restart) a single connection at runtime. Idempotent. */
  async addConnection(connection: ConnectionRecord): Promise<void> {
    if (this.hosts.has(connection.id)) await this.stopConnection(connection.id);
    await this.startConnection(connection);
  }

  /** Stop and forget a connection's DriverHost and cached devices. */
  async stopConnection(connectionId: string): Promise<void> {
    const host = this.hosts.get(connectionId);
    if (host) {
      await host.stop();
      this.hosts.delete(connectionId);
    }
    for (const d of this.devicesByConnection.get(connectionId) ?? []) this.deviceCache.delete(d.id);
    this.devicesByConnection.delete(connectionId);
    this.driverIds.delete(connectionId);
  }

  /** Re-read a connection's devices into the cache (after device CRUD). */
  async refreshConnectionDevices(connectionId: string): Promise<void> {
    const devices = await this.opts.repo.listDevicesByConnection(connectionId);
    for (const d of this.devicesByConnection.get(connectionId) ?? []) this.deviceCache.delete(d.id);
    this.devicesByConnection.set(connectionId, devices);
    for (const d of devices) this.deviceCache.set(d.id, d);
  }

  isConnectionRunning(connectionId: string): boolean {
    return this.hosts.has(connectionId);
  }

  /** Snapshot of all running driver hosts (for system/drivers). */
  driverStatuses(): DriverStatus[] {
    return [...this.hosts.entries()].map(([connectionId, host]) => ({
      connectionId,
      driverId: this.driverIds.get(connectionId) ?? "unknown",
      running: true,
      connected: host.isConnected(),
    }));
  }

  private async startConnection(connection: ConnectionRecord): Promise<void> {
    const devices = await this.opts.repo.listDevicesByConnection(connection.id);
    this.devicesByConnection.set(connection.id, devices);
    this.driverIds.set(connection.id, connection.driverId);
    for (const d of devices) this.deviceCache.set(d.id, d);

    const host = new DriverHost({
      connection: {
        id: connection.id,
        driver: connection.driverId,
        host: connection.host ?? "",
        port: connection.port ?? 0,
        config: connection.config,
      },
      logger: this.opts.logger.child(`driver:${connection.driverId}`),
      storage: this.opts.driverKVStore(connection.id),
      dryRun: this.opts.dryRun,
      restart: this.opts.restart,
      commandTimeoutMs: this.opts.commandTimeoutMs,
    });

    this.wireHostEvents(host, connection.id);
    this.hosts.set(connection.id, host);

    try {
      await host.start();
    } catch (err) {
      this.log.error("failed to start connection", {
        connectionId: connection.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Bridge DriverHost events to the state store and the EventBus. */
  private wireHostEvents(host: DriverHost, connectionId: string): void {
    host.on("connected", () => {
      void this.opts.state.setConnectionStatus(connectionId, {
        online: true,
        lastSeen: new Date().toISOString(),
      });
      this.opts.eventBus.emit({ type: "connection.connected", connectionId });
      this.markDevices(connectionId, true);
      this.subscribeEndpoints(host, connectionId);
    });

    host.on("disconnected", (reason: string) => {
      void this.opts.state.setConnectionStatus(connectionId, {
        online: false,
        lastError: reason,
        lastSeen: new Date().toISOString(),
      });
      this.opts.eventBus.emit({ type: "connection.disconnected", connectionId, reason });
      this.markDevices(connectionId, false, reason);
    });

    host.on("state", (event) => {
      void this.opts.state.setDeviceState(event.endpointId, event.state);
      this.opts.eventBus.emit({
        type: "device.state.changed",
        deviceId: event.endpointId,
        state: event.state,
        source: event.source,
      });
    });

    host.on("error", (error) => {
      this.opts.eventBus.emit({ type: "connection.error", connectionId, error: error.message });
    });

    host.on("crashed", (info) => {
      this.opts.eventBus.emit({
        type: "system.driver.crashed",
        connectionId,
        driverId: this.driverIdOf(connectionId),
        error: info.error?.message ?? `exit code ${info.exitCode}`,
      });
      this.markDevices(connectionId, false, "driver_crashed");
    });
  }

  /** Update every device of a connection to online/offline + emit events. */
  private markDevices(connectionId: string, online: boolean, reason = ""): void {
    const devices = this.devicesByConnection.get(connectionId) ?? [];
    for (const device of devices) {
      void this.opts.state.setDeviceStatus(device.id, {
        online,
        lastSeen: new Date().toISOString(),
        lastError: online ? undefined : reason,
      });
      this.opts.eventBus.emit(
        online
          ? { type: "device.online", deviceId: device.id, connectionId }
          : { type: "device.offline", deviceId: device.id, connectionId, reason },
      );
    }
  }

  /**
   * Subscribe a connection's endpoints when it comes online, for drivers whose
   * manifest declares subscription support. Fires on every `connected` event, so
   * it covers both the first connect and a subprocess restart (where the driver
   * process is fresh and its own subscription map is empty). Idempotent: a driver
   * re-subscribing the same parameter is harmless.
   */
  private subscribeEndpoints(host: DriverHost, connectionId: string): void {
    const driverId = this.driverIds.get(connectionId);
    if (!driverId || !this.opts.supportsSubscriptions?.(driverId)) return;
    const devices = this.devicesByConnection.get(connectionId) ?? [];
    for (const device of devices) {
      this.log.debug("subscribing endpoint", { connectionId, deviceId: device.id });
      host.subscribeToEndpoint(toEndpoint(device));
    }
  }

  /**
   * Execute a command against a device. Serialised per device id to avoid
   * concurrent commands racing on the same endpoint.
   */
  execute(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<import("@gallery/driver-core").CommandResult> {
    return this.withLock(deviceId, async () => {
      const device = await this.resolveDevice(deviceId);
      const host = this.hosts.get(device.connectionId);
      if (!host) throw new Error(`no active driver for connection ${device.connectionId}`);

      // Log the command going out to the device.
      this.log.info("command requested", { deviceId, device: device.name, command, params });

      const endpoint = toEndpoint(device);
      const result = await host.executeCommand(endpoint, command, params);

      if (result.success && result.state) {
        await this.opts.state.setDeviceState(deviceId, result.state);
        this.opts.eventBus.emit({
          type: "device.state.changed",
          deviceId,
          state: result.state,
          source: "command",
        });
      }
      // Log the device's response.
      this.log[result.success ? "info" : "warn"]("command result", {
        deviceId,
        command,
        success: result.success,
        durationMs: result.durationMs,
        state: result.state,
        error: result.error,
      });
      return result;
    });
  }

  /** Read state: prefer the Redis cache, fall back to querying the device. */
  async readState(deviceId: string): Promise<Record<string, unknown>> {
    const cached = await this.opts.state.getDeviceState(deviceId);
    if (cached) {
      this.log.debug("state read (cache)", { deviceId, state: cached });
      return cached;
    }

    const device = await this.resolveDevice(deviceId);
    const host = this.hosts.get(device.connectionId);
    if (!host) throw new Error(`no active driver for connection ${device.connectionId}`);

    const state = await host.readState(toEndpoint(device));
    await this.opts.state.setDeviceState(deviceId, state);
    // Log the device's response.
    this.log.info("device state read", { deviceId, device: device.name, state });
    return state;
  }

  /** Whether the connection behind a device is currently connected. */
  isDeviceConnectionOnline(deviceId: string): boolean {
    const device = this.deviceCache.get(deviceId);
    return device ? (this.hosts.get(device.connectionId)?.isConnected() ?? false) : false;
  }

  // ── Watchdog API ───────────────────────────────────────────

  /** All connection IDs with a running DriverHost. Used by Watchdog layer 1. */
  listRunningConnectionIds(): string[] {
    return [...this.hosts.keys()];
  }

  /** Active health check against a connection's driver subprocess. Used by Watchdog layer 1. */
  healthCheckConnection(connectionId: string): Promise<import("@gallery/driver-core").HealthStatus> {
    const host = this.hosts.get(connectionId);
    if (!host) throw new Error(`no running host for connection ${connectionId}`);
    return host.healthCheck();
  }

  /** Devices registered under a connection (in-memory cache). Used by Watchdog layer 2. */
  devicesForConnection(connectionId: string): DeviceRecord[] {
    return this.devicesByConnection.get(connectionId) ?? [];
  }

  /**
   * Per-endpoint health check. Returns null when the driver does not support it
   * (endpointHealthCheck IPC call times out or errors). Used by Watchdog layer 2.
   */
  async endpointHealthCheck(deviceId: string): Promise<import("@gallery/driver-core").HealthStatus | null> {
    const device = this.deviceCache.get(deviceId);
    if (!device) return null;
    const host = this.hosts.get(device.connectionId);
    if (!host) return null;
    try {
      return await host.endpointHealthCheck(toEndpoint(device));
    } catch {
      return null;
    }
  }

  // ── internals ──────────────────────────────────────────────

  private async resolveDevice(deviceId: string): Promise<DeviceRecord> {
    const cached = this.deviceCache.get(deviceId);
    if (cached) return cached;
    const device = await this.opts.repo.getDevice(deviceId);
    if (!device) throw new Error(`device not found: ${deviceId}`);
    this.deviceCache.set(deviceId, device);
    return device;
  }

  private driverIdOf(connectionId: string): string {
    return this.driverIds.get(connectionId) ?? "unknown";
  }

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}

/** Build the driver-facing endpoint descriptor from a device record. */
function toEndpoint(device: DeviceRecord): EndpointDescriptor {
  return { id: device.id, type: device.endpointType, address: device.address, name: device.name };
}
