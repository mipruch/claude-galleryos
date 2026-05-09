import type { FastifyInstance } from 'fastify';
import { query } from '../db/index.js';
import { redis } from '../redis.js';
import { deviceManager } from '../core/DeviceManager.js';
import { driverHost } from '../drivers/DriverHost.js';
import { listManifests, getDriver } from '../core/DriverRegistry.js';

export default async function connectionsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/connections', async () => {
    const r = await query(`SELECT * FROM connections ORDER BY name ASC`);
    return r.rows;
  });

  app.post('/connections', async (req, reply) => {
    const body = req.body as any;
    if (!body?.name || !body?.driver_id) {
      return reply.code(400).send({ error: 'name_and_driver_id_required' });
    }
    if (!getDriver(body.driver_id)) {
      return reply.code(400).send({ error: 'unknown_driver' });
    }
    const r = await query(
      `INSERT INTO connections (name, driver_id, host, port, protocol, config, enabled)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'tcp'), COALESCE($6, '{}'::jsonb), COALESCE($7, TRUE))
       RETURNING *`,
      [
        body.name,
        body.driver_id,
        body.host ?? null,
        body.port ?? null,
        body.protocol,
        JSON.stringify(body.config ?? {}),
        body.enabled,
      ]
    );
    const conn = r.rows[0];
    await deviceManager.addConnection(conn);
    return conn;
  });

  app.get('/connections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await query(`SELECT * FROM connections WHERE id = $1`, [id]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.put('/connections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const r = await query(
      `UPDATE connections
         SET name = COALESCE($2, name),
             host = COALESCE($3, host),
             port = COALESCE($4, port),
             protocol = COALESCE($5, protocol),
             config = COALESCE($6, config),
             enabled = COALESCE($7, enabled),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body.name,
        body.host,
        body.port,
        body.protocol,
        body.config ? JSON.stringify(body.config) : null,
        body.enabled,
      ]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    await deviceManager.restartConnection(id);
    return r.rows[0];
  });

  app.delete('/connections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await query(
      `SELECT COUNT(*)::int AS n FROM devices WHERE connection_id = $1`,
      [id]
    );
    if ((c.rows[0] as { n: number }).n > 0) {
      return reply.code(409).send({ error: 'connection_has_devices' });
    }
    await deviceManager.removeConnection(id);
    await query(`DELETE FROM connections WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.post('/connections/:id/connect', async (req) => {
    const { id } = req.params as { id: string };
    await deviceManager.restartConnection(id);
    return { ok: true };
  });

  app.post('/connections/:id/disconnect', async (req) => {
    const { id } = req.params as { id: string };
    await driverHost.stop(id);
    return { ok: true };
  });

  app.get('/connections/:id/status', async (req) => {
    const { id } = req.params as { id: string };
    const raw = await redis.get(`connection:${id}:status`);
    return raw ? JSON.parse(raw) : { online: false };
  });

  app.post('/connections/:id/discover', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await driverHost.discoverEndpoints(id);
      return { endpoints: result };
    } catch (err) {
      return reply.code(503).send({
        error: 'discover_failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get('/drivers', async () => listManifests());

  app.get('/drivers/:id/manifest', async (req, reply) => {
    const { id } = req.params as { id: string };
    const reg = getDriver(id);
    if (!reg) return reply.code(404).send({ error: 'not_found' });
    return reg.manifest;
  });
}
