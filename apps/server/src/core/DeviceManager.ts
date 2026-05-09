import type { CommandResult, EndpointDescriptor } from '@galleryos/driver-core';
import type { Connection, Device } from '@galleryos/types';
import { driverHost } from '../drivers/DriverHost.js';
import { query } from '../db/index.js';
import { redis } from '../redis.js';
import { childLogger } from '../logger.js';
import { eventBus } from './EventBus.js';
import { MutexMap } from './AsyncMutex.js';

const log = childLogger('device_manager');

export class DeviceManager {
  private endpointMutex = new MutexMap();
  private deviceCache = new Map<string, Device>();
  private connectionCache = new Map<string, Connection>();

  async start(): Promise<void> {
    const conns = await query<Connection>(
      `SELECT * FROM connections WHERE enabled = TRUE`
    );
    for (const conn of conns.rows) {
      this.connectionCache.set(conn.id, conn);
      await this.startConnection(conn);
    }

    const devices = await query<Device>(`SELECT * FROM devices WHERE enabled = TRUE`);
    for (const dev of devices.rows) this.deviceCache.set(dev.id, dev);

    eventBus.on('event', (e: any) => {
      if (e.type === 'connection.connected') {
        this.markConnectionDevicesOnline(e.connectionId, true);
      } else if (e.type === 'connection.disconnected' || e.type === 'system.driver.crashed') {
        this.markConnectionDevicesOnline(e.connectionId, false, e.reason || 'connection_lost');
      }
    });

    eventBus.on('driver.state', async ({ connectionId: _connId, event }: any) => {
      const deviceId = event.endpointId;
      const state = event.state as Record<string, unknown>;
      await this.persistDeviceState(deviceId, state, event.source);
    });

    log.info('DeviceManager started', {
      connections: conns.rowCount,
      devices: devices.rowCount,
    });
  }

  async stop(): Promise<void> {
    await driverHost.stopAll();
  }

  private async startConnection(conn: Connection): Promise<void> {
    try {
      await driverHost.start({
        id: conn.id,
        driver: conn.driver_id,
        driverId: conn.driver_id,
        host: conn.host ?? '',
        port: conn.port ?? 0,
        config: conn.config ?? {},
      } as any);
    } catch (err) {
      log.error('Failed to start driver subprocess', {
        connectionId: conn.id,
        driverId: conn.driver_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async addConnection(conn: Connection): Promise<void> {
    this.connectionCache.set(conn.id, conn);
    if (conn.enabled) await this.startConnection(conn);
  }

  async removeConnection(connectionId: string): Promise<void> {
    this.connectionCache.delete(connectionId);
    await driverHost.stop(connectionId);
  }

  async restartConnection(connectionId: string): Promise<void> {
    await driverHost.stop(connectionId);
    const conn = this.connectionCache.get(connectionId);
    if (conn?.enabled) await this.startConnection(conn);
  }

  upsertDeviceCache(device: Device): void {
    this.deviceCache.set(device.id, device);
  }

  removeDeviceCache(deviceId: string): void {
    this.deviceCache.delete(deviceId);
  }

  private async getDevice(deviceId: string): Promise<Device | null> {
    const cached = this.deviceCache.get(deviceId);
    if (cached) return cached;
    const r = await query<Device>(`SELECT * FROM devices WHERE id = $1`, [deviceId]);
    if (!r.rows[0]) return null;
    this.deviceCache.set(deviceId, r.rows[0]);
    return r.rows[0];
  }

  private toEndpoint(device: Device): EndpointDescriptor {
    return {
      id: device.id,
      type: device.subtype ?? '',
      address: device.address ?? {},
      name: device.name,
    };
  }

  async execute(
    deviceId: string,
    command: string,
    params: Record<string, unknown>
  ): Promise<CommandResult> {
    const dev = await this.getDevice(deviceId);
    if (!dev) return { success: false, durationMs: 0, error: 'device_not_found' };
    const ep = this.toEndpoint(dev);

    return this.endpointMutex.for(deviceId).run(async () => {
      try {
        const result = await driverHost.executeCommand(dev.connection_id, ep, command, params);
        if (result.success && result.state) {
          await this.persistDeviceState(deviceId, result.state, 'command');
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn('execute failed', { deviceId, command, error: message });
        return { success: false, durationMs: 0, error: message };
      }
    });
  }

  async readState(deviceId: string): Promise<Record<string, unknown>> {
    const cached = await redis.get(`device:${deviceId}:state`);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* ignore */
      }
    }
    const dev = await this.getDevice(deviceId);
    if (!dev) return {};
    try {
      const state = await driverHost.readState(dev.connection_id, this.toEndpoint(dev));
      await redis.set(`device:${deviceId}:state`, JSON.stringify(state));
      return state;
    } catch {
      return {};
    }
  }

  private async persistDeviceState(
    deviceId: string,
    state: Record<string, unknown>,
    source: string
  ): Promise<void> {
    try {
      const existingRaw = await redis.get(`device:${deviceId}:state`);
      const merged = existingRaw ? { ...JSON.parse(existingRaw), ...state } : state;
      await redis.set(`device:${deviceId}:state`, JSON.stringify(merged));
    } catch {
      await redis.set(`device:${deviceId}:state`, JSON.stringify(state));
    }
    eventBus.emit('event', {
      type: 'device.state.changed',
      deviceId,
      state,
      source,
    });
  }

  private async markConnectionDevicesOnline(
    connectionId: string,
    online: boolean,
    reason = ''
  ): Promise<void> {
    const r = await query<Device>(
      `SELECT id FROM devices WHERE connection_id = $1 AND enabled = TRUE`,
      [connectionId]
    );
    for (const dev of r.rows) {
      await redis.set(
        `device:${dev.id}:status`,
        JSON.stringify({ online, lastSeen: new Date().toISOString() })
      );
      eventBus.emit('event', {
        type: online ? 'device.online' : 'device.offline',
        deviceId: dev.id,
        connectionId,
        reason,
      });
    }
    await redis.set(
      `connection:${connectionId}:status`,
      JSON.stringify({ online, lastSeen: new Date().toISOString() })
    );
  }
}

export const deviceManager = new DeviceManager();
