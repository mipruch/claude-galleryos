import type { FastifyInstance } from 'fastify';
import { query } from '../db/index.js';
import { refreshMappings } from '../input/InputMapper.js';

export default async function mappingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mappings', async () => {
    const r = await query(`SELECT * FROM input_mappings ORDER BY name ASC`);
    return r.rows;
  });

  app.post('/mappings', async (req, reply) => {
    const body = req.body as any;
    if (!body?.name || !body?.protocol || !body?.pattern || !body?.target_type) {
      return reply.code(400).send({ error: 'missing_required_fields' });
    }
    const r = await query(
      `INSERT INTO input_mappings
        (name, protocol, pattern, target_type, target_id, target_command, params_template, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'{}'::jsonb),COALESCE($8,TRUE))
       RETURNING *`,
      [
        body.name,
        body.protocol,
        body.pattern,
        body.target_type,
        body.target_id ?? null,
        body.target_command ?? null,
        JSON.stringify(body.params_template ?? {}),
        body.enabled,
      ]
    );
    await refreshMappings();
    return r.rows[0];
  });

  app.get('/mappings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await query(`SELECT * FROM input_mappings WHERE id = $1`, [id]);
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.put('/mappings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const r = await query(
      `UPDATE input_mappings SET
         name = COALESCE($2, name),
         protocol = COALESCE($3, protocol),
         pattern = COALESCE($4, pattern),
         target_type = COALESCE($5, target_type),
         target_id = COALESCE($6, target_id),
         target_command = COALESCE($7, target_command),
         params_template = COALESCE($8, params_template),
         enabled = COALESCE($9, enabled),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        id,
        body.name,
        body.protocol,
        body.pattern,
        body.target_type,
        body.target_id,
        body.target_command,
        body.params_template ? JSON.stringify(body.params_template) : null,
        body.enabled,
      ]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    await refreshMappings();
    return r.rows[0];
  });

  app.delete('/mappings/:id', async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM input_mappings WHERE id = $1`, [id]);
    await refreshMappings();
    return { ok: true };
  });
}
