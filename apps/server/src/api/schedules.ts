import type { FastifyInstance } from 'fastify';
import { query } from '../db/index.js';
import { scheduler } from '../core/Scheduler.js';

export default async function schedulesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/schedules', async () => {
    const r = await query(`SELECT * FROM scheduled_jobs ORDER BY name ASC`);
    return r.rows;
  });

  app.post('/schedules', async (req, reply) => {
    const body = req.body as any;
    if (!body?.name || !body?.cron || !body?.scene_id) {
      return reply.code(400).send({ error: 'name_cron_scene_required' });
    }
    const r = await query(
      `INSERT INTO scheduled_jobs (name, scene_id, cron, timezone, enabled)
       VALUES ($1,$2,$3,COALESCE($4,'Europe/Prague'),COALESCE($5,TRUE))
       RETURNING *`,
      [body.name, body.scene_id, body.cron, body.timezone, body.enabled]
    );
    if (r.rows[0].enabled) scheduler.register(r.rows[0]);
    return r.rows[0];
  });

  app.get('/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await query(`SELECT * FROM scheduled_jobs WHERE id = $1`, [id]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.put('/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const r = await query(
      `UPDATE scheduled_jobs SET
         name = COALESCE($2, name),
         scene_id = COALESCE($3, scene_id),
         cron = COALESCE($4, cron),
         timezone = COALESCE($5, timezone),
         enabled = COALESCE($6, enabled),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, body.name, body.scene_id, body.cron, body.timezone, body.enabled]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    scheduler.reload(r.rows[0]);
    return r.rows[0];
  });

  app.delete('/schedules/:id', async (req) => {
    const { id } = req.params as { id: string };
    scheduler.unregister(id);
    await query(`DELETE FROM scheduled_jobs WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.patch('/schedules/:id/toggle', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await query(
      `UPDATE scheduled_jobs SET enabled = NOT enabled, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    scheduler.reload(r.rows[0]);
    return r.rows[0];
  });
}
