import type { FastifyInstance } from 'fastify';
import { query } from '../db/index.js';
import { redis } from '../redis.js';
import { deviceManager } from '../core/DeviceManager.js';

export default async function devicesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/devices', async (req) => {
    const q = req.query as any;
    const where: string[] = [];
    const values: unknown[] = [];
    if (q.room_id) {
      values.push(q.room_id);
      where.push(`room_id = $${values.length}`);
    }
    if (q.type) {
      values.push(q.type);
      where.push(`type = $${values.length}`);
    }
    if (q.enabled !== undefined) {
      values.push(q.enabled === 'true' || q.enabled === true);
      where.push(`enabled = $${values.length}`);
    }
    const sql = `SELECT * FROM devices ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY display_order ASC, name ASC`;
    const r = await query(sql, values);
    return r.rows;
  });

  app.post('/devices', async (req, reply) => {
    const body = req.body as any;
    if (!body?.name || !body?.connection_id || !body?.type || !body?.address) {
      return reply.code(400).send({ error: 'missing_required_fields' });
    }
    const r = await query(
      `INSERT INTO devices (
         connection_id, room_id, name, description, type, subtype, address,
         capabilities, metadata, icon, display_order, enabled
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 0), COALESCE($12, TRUE))
       RETURNING *`,
      [
        body.connection_id,
        body.room_id ?? null,
        body.name,
        body.description ?? null,
        body.type,
        body.subtype ?? null,
        JSON.stringify(body.address),
        JSON.stringify(body.capabilities ?? []),
        JSON.stringify(body.metadata ?? {}),
        body.icon ?? null,
        body.display_order,
        body.enabled,
      ]
    );
    const dev = r.rows[0];
    deviceManager.upsertDeviceCache(dev as any);
    return dev;
  });

  app.get('/devices/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await query(`SELECT * FROM devices WHERE id = $1`, [id]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.put('/devices/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const r = await query(
      `UPDATE devices SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         room_id = COALESCE($4, room_id),
         type = COALESCE($5, type),
         subtype = COALESCE($6, subtype),
         address = COALESCE($7, address),
         capabilities = COALESCE($8, capabilities),
         metadata = COALESCE($9, metadata),
         icon = COALESCE($10, icon),
         display_order = COALESCE($11, display_order),
         enabled = COALESCE($12, enabled),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        id,
        body.name,
        body.description,
        body.room_id,
        body.type,
        body.subtype,
        body.address ? JSON.stringify(body.address) : null,
        body.capabilities ? JSON.stringify(body.capabilities) : null,
        body.metadata ? JSON.stringify(body.metadata) : null,
        body.icon,
        body.display_order,
        body.enabled,
      ]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    deviceManager.upsertDeviceCache(r.rows[0] as any);
    return r.rows[0];
  });

  app.delete('/devices/:id', async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM devices WHERE id = $1`, [id]);
    deviceManager.removeDeviceCache(id);
    return { ok: true };
  });

  app.get('/devices/:id/status', async (req) => {
    const { id } = req.params as { id: string };
    const raw = await redis.get(`device:${id}:status`);
    return raw ? JSON.parse(raw) : { online: false };
  });

  app.get('/devices/:id/state', async (req) => {
    const { id } = req.params as { id: string };
    return deviceManager.readState(id);
  });

  app.post('/devices/:id/command', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    if (!body?.command) return reply.code(400).send({ error: 'command_required' });
    const result = await deviceManager.execute(id, body.command, body.params ?? {});
    if (!result.success) return reply.code(503).send(result);
    return result;
  });
}
