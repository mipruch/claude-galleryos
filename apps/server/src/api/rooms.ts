import type { FastifyInstance } from 'fastify';
import { query } from '../db/index.js';

export default async function roomsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/rooms', async () => {
    const r = await query(`SELECT * FROM rooms ORDER BY display_order ASC, name ASC`);
    return r.rows;
  });

  app.post('/rooms', async (req, reply) => {
    const body = req.body as any;
    if (!body?.name) return reply.code(400).send({ error: 'name_required' });
    const r = await query(
      `INSERT INTO rooms (name, description, icon, color, display_order)
       VALUES ($1, $2, $3, $4, COALESCE($5, 0)) RETURNING *`,
      [body.name, body.description ?? null, body.icon ?? null, body.color ?? null, body.display_order]
    );
    return r.rows[0];
  });

  app.get('/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await query(`SELECT * FROM rooms WHERE id = $1`, [id]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.put('/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const r = await query(
      `UPDATE rooms
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             icon = COALESCE($4, icon),
             color = COALESCE($5, color),
             display_order = COALESCE($6, display_order),
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, body.name, body.description, body.icon, body.color, body.display_order]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.delete('/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const counts = await query(
      `SELECT
        (SELECT COUNT(*)::int FROM devices WHERE room_id = $1) AS devices,
        (SELECT COUNT(*)::int FROM scenes WHERE room_id = $1) AS scenes`,
      [id]
    );
    const c = counts.rows[0] as { devices: number; scenes: number };
    if (c.devices > 0 || c.scenes > 0) {
      return reply.code(409).send({ error: 'room_in_use', details: c });
    }
    await query(`DELETE FROM rooms WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.get('/rooms/:id/devices', async (req) => {
    const { id } = req.params as { id: string };
    const r = await query(`SELECT * FROM devices WHERE room_id = $1 ORDER BY display_order ASC`, [id]);
    return r.rows;
  });

  app.get('/rooms/:id/scenes', async (req) => {
    const { id } = req.params as { id: string };
    const r = await query(`SELECT * FROM scenes WHERE room_id = $1 ORDER BY name ASC`, [id]);
    return r.rows;
  });
}
