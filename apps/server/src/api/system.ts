import type { FastifyInstance } from 'fastify';
import { query } from '../db/index.js';
import { redis } from '../redis.js';
import { driverHost } from '../drivers/DriverHost.js';
import { listManifests } from '../core/DriverRegistry.js';

const startedAt = Date.now();

export default async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/system/status', async () => {
    const runningScenes = await query(
      `SELECT COUNT(*)::int AS n FROM scene_executions WHERE status = 'running'`
    );
    const stats = await redis.get('system:stats');
    return {
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      runningScenes: (runningScenes.rows[0] as { n: number }).n,
      stats: stats ? JSON.parse(stats) : {},
      drivers: driverHost.status(),
    };
  });

  app.get('/system/drivers', async () => ({
    available: listManifests(),
    running: driverHost.status(),
  }));

  app.post('/system/reload-drivers', async () => {
    await driverHost.stopAll();
    const conns = await query(`SELECT id FROM connections WHERE enabled = TRUE`);
    for (const row of conns.rows as { id: string }[]) {
      const c = await query(`SELECT * FROM connections WHERE id = $1`, [row.id]);
      const conn = c.rows[0] as any;
      await driverHost.start({
        id: conn.id,
        driver: conn.driver_id,
        driverId: conn.driver_id,
        host: conn.host ?? '',
        port: conn.port ?? 0,
        config: conn.config,
      } as any);
    }
    return { ok: true };
  });
}
