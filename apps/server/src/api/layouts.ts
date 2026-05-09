import type { FastifyInstance } from 'fastify';
import { query, tx } from '../db/index.js';

export default async function layoutsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/layouts', async (req) => {
    const q = req.query as any;
    if (q.default === 'true' || q.default === true) {
      const r = await query(`SELECT * FROM ui_layouts WHERE is_default = TRUE LIMIT 1`);
      return r.rows[0] ?? null;
    }
    const r = await query(`SELECT * FROM ui_layouts ORDER BY name ASC`);
    return r.rows;
  });

  app.post('/layouts', async (req, reply) => {
    const body = req.body as any;
    if (!body?.name) return reply.code(400).send({ error: 'name_required' });
    const r = await query(
      `INSERT INTO ui_layouts (name, is_default, config)
       VALUES ($1, COALESCE($2, FALSE), COALESCE($3, '{}'::jsonb))
       RETURNING *`,
      [body.name, body.is_default, JSON.stringify(body.config ?? { pages: [] })]
    );
    return r.rows[0];
  });

  app.get('/layouts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await query(`SELECT * FROM ui_layouts WHERE id = $1`, [id]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.put('/layouts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const r = await query(
      `UPDATE ui_layouts SET
         name = COALESCE($2, name),
         config = COALESCE($3, config),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, body.name, body.config ? JSON.stringify(body.config) : null]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.delete('/layouts/:id', async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM ui_layouts WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.patch('/layouts/:id/default', async (req, reply) => {
    const { id } = req.params as { id: string };
    return tx(async (client) => {
      await client.query(`UPDATE ui_layouts SET is_default = FALSE`);
      const r = await client.query(
        `UPDATE ui_layouts SET is_default = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      );
      if (!r.rows[0]) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return r.rows[0];
    });
  });
}
