import { config as appConfig } from '../config.js';
import { driverHost } from '../drivers/DriverHost.js';
import { query } from '../db/index.js';
import { redis } from '../redis.js';
import { childLogger } from '../logger.js';
import { eventBus } from './EventBus.js';

const log = childLogger('watchdog');

interface ConnRow {
  id: string;
  enabled: boolean;
}

export class Watchdog {
  private connInterval: NodeJS.Timeout | null = null;
  private endpointInterval: NodeJS.Timeout | null = null;

  start(): void {
    this.connInterval = setInterval(
      () => this.checkConnections(),
      appConfig.watchdogConnectionIntervalMs
    );
    this.endpointInterval = setInterval(
      () => this.checkEndpoints(),
      appConfig.watchdogEndpointIntervalMs
    );
    log.info('Watchdog started', {
      connectionMs: appConfig.watchdogConnectionIntervalMs,
      endpointMs: appConfig.watchdogEndpointIntervalMs,
    });
  }

  stop(): void {
    if (this.connInterval) clearInterval(this.connInterval);
    if (this.endpointInterval) clearInterval(this.endpointInterval);
  }

  private async checkConnections(): Promise<void> {
    const r = await query<ConnRow>(`SELECT id FROM connections WHERE enabled = TRUE`);
    await Promise.all(
      r.rows.map(async (row) => {
        try {
          const start = Date.now();
          const status = await driverHost.healthCheck(row.id);
          const latencyMs = Date.now() - start;
          const prevRaw = await redis.get(`connection:${row.id}:status`);
          const prev = prevRaw ? JSON.parse(prevRaw).online : undefined;
          await redis.set(
            `connection:${row.id}:status`,
            JSON.stringify({ online: status.online, latencyMs, lastSeen: new Date().toISOString() })
          );
          if (prev !== status.online) {
            eventBus.emit('event', {
              type: status.online ? 'connection.connected' : 'connection.disconnected',
              connectionId: row.id,
              reason: status.online ? '' : 'watchdog_offline',
            });
          }
        } catch {
          await redis.set(
            `connection:${row.id}:status`,
            JSON.stringify({ online: false, lastSeen: new Date().toISOString() })
          );
        }
      })
    );
  }

  private async checkEndpoints(): Promise<void> {
    // Endpoint-level health-check is opt-in per driver. MVP: skip — connection
    // health propagates to all child devices via DeviceManager subscriptions.
  }
}

export const watchdog = new Watchdog();
