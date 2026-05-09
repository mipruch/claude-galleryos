import type { FastifyInstance } from 'fastify';
import { query, tx } from '../db/index.js';
import { sceneEngine } from '../core/SceneEngine.js';

export default async function scenesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/scenes', async (req) => {
    const q = req.query as any;
    const where: string[] = [];
    const values: unknown[] = [];
    if (q.room_id) {
      values.push(q.room_id);
      where.push(`room_id = $${values.length}`);
    }
    if (q.is_favorite !== undefined) {
      values.push(q.is_favorite === 'true' || q.is_favorite === true);
      where.push(`is_favorite = $${values.length}`);
    }
    const sql = `SELECT * FROM scenes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name ASC`;
    const r = await query(sql, values);
    return r.rows;
  });

  app.post('/scenes', async (req, reply) => {
    const body = req.body as any;
    if (!body?.name) return reply.code(400).send({ error: 'name_required' });
    const result = await tx(async (client) => {
      const sceneRes = await client.query(
        `INSERT INTO scenes (room_id, name, description, icon, color, is_favorite, tags, variables, enabled)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,FALSE),COALESCE($7,'{}'),$8,COALESCE($9,TRUE))
         RETURNING *`,
        [
          body.room_id ?? null,
          body.name,
          body.description ?? null,
          body.icon ?? null,
          body.color ?? null,
          body.is_favorite,
          body.tags ?? [],
          JSON.stringify(body.variables ?? {}),
          body.enabled,
        ]
      );
      const scene = sceneRes.rows[0];
      const actions = body.actions ?? [];
      for (const a of actions) {
        await client.query(
          `INSERT INTO scene_actions
            (scene_id, device_id, step_order, parallel_group, delay_ms, command, params, on_failure)
           VALUES ($1,$2,COALESCE($3,0),COALESCE($4,0),COALESCE($5,0),$6,$7,COALESCE($8,'continue'))`,
          [
            scene.id,
            a.device_id,
            a.step_order,
            a.parallel_group,
            a.delay_ms,
            a.command,
            JSON.stringify(a.params ?? {}),
            a.on_failure,
          ]
        );
      }
      return scene;
    });
    return result;
  });

  app.get('/scenes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sceneRes = await query(`SELECT * FROM scenes WHERE id = $1`, [id]);
    if (!sceneRes.rows[0]) return reply.code(404).send({ error: 'not_found' });
    const actions = await query(
      `SELECT * FROM scene_actions WHERE scene_id = $1 ORDER BY parallel_group, step_order`,
      [id]
    );
    return { ...sceneRes.rows[0], actions: actions.rows };
  });

  app.put('/scenes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const result = await tx(async (client) => {
      const existingRes = await client.query(`SELECT * FROM scenes WHERE id = $1`, [id]);
      if (!existingRes.rows[0]) return null;
      const existing = existingRes.rows[0];
      // Snapshot current scene into scene_versions
      const actionsRes = await client.query(
        `SELECT * FROM scene_actions WHERE scene_id = $1 ORDER BY parallel_group, step_order`,
        [id]
      );
      await client.query(
        `INSERT INTO scene_versions (scene_id, version, snapshot)
         VALUES ($1, $2, $3)`,
        [id, existing.version, JSON.stringify({ scene: existing, actions: actionsRes.rows })]
      );
      const sceneRes = await client.query(
        `UPDATE scenes SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           icon = COALESCE($4, icon),
           color = COALESCE($5, color),
           is_favorite = COALESCE($6, is_favorite),
           tags = COALESCE($7, tags),
           variables = COALESCE($8, variables),
           room_id = COALESCE($9, room_id),
           enabled = COALESCE($10, enabled),
           version = version + 1,
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [
          id,
          body.name,
          body.description,
          body.icon,
          body.color,
          body.is_favorite,
          body.tags,
          body.variables ? JSON.stringify(body.variables) : null,
          body.room_id,
          body.enabled,
        ]
      );
      if (Array.isArray(body.actions)) {
        await client.query(`DELETE FROM scene_actions WHERE scene_id = $1`, [id]);
        for (const a of body.actions) {
          await client.query(
            `INSERT INTO scene_actions
              (scene_id, device_id, step_order, parallel_group, delay_ms, command, params, on_failure)
             VALUES ($1,$2,COALESCE($3,0),COALESCE($4,0),COALESCE($5,0),$6,$7,COALESCE($8,'continue'))`,
            [
              id,
              a.device_id,
              a.step_order,
              a.parallel_group,
              a.delay_ms,
              a.command,
              JSON.stringify(a.params ?? {}),
              a.on_failure,
            ]
          );
        }
      }
      return sceneRes.rows[0];
    });
    if (!result) return reply.code(404).send({ error: 'not_found' });
    return result;
  });

  app.delete('/scenes/:id', async (req) => {
    const { id } = req.params as { id: string };
    await query(`DELETE FROM scenes WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.post('/scenes/:id/execute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as any) ?? {};
    try {
      const result = await sceneEngine.executeScene(id, {
        source: body.source ?? 'api',
      });
      return { sceneId: id, ...result, status: 'started' };
    } catch (err) {
      return reply.code(409).send({
        error: 'execute_failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/scenes/:id/execute/dry-run', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await sceneEngine.executeScene(id, { source: 'api', dryRun: true });
      return result;
    } catch (err) {
      return reply.code(409).send({
        error: 'dry_run_failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get('/scenes/:id/executions', async (req) => {
    const { id } = req.params as { id: string };
    const r = await query(
      `SELECT * FROM scene_executions WHERE scene_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [id]
    );
    return r.rows;
  });

  app.get('/scenes/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    const r = await query(
      `SELECT id, version, created_at, created_by FROM scene_versions
       WHERE scene_id = $1 ORDER BY version DESC`,
      [id]
    );
    return r.rows;
  });

  app.get('/scenes/:id/versions/:version', async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    const r = await query(
      `SELECT * FROM scene_versions WHERE scene_id = $1 AND version = $2`,
      [id, Number(version)]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });

  app.post('/scenes/:id/versions/:version/restore', async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    return tx(async (client) => {
      const verRes = await client.query(
        `SELECT * FROM scene_versions WHERE scene_id = $1 AND version = $2`,
        [id, Number(version)]
      );
      if (!verRes.rows[0]) {
        reply.code(404);
        return { error: 'version_not_found' };
      }
      const snapshot = verRes.rows[0].snapshot as any;
      await client.query(`DELETE FROM scene_actions WHERE scene_id = $1`, [id]);
      for (const a of snapshot.actions ?? []) {
        await client.query(
          `INSERT INTO scene_actions
            (scene_id, device_id, step_order, parallel_group, delay_ms, command, params, on_failure)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            a.device_id,
            a.step_order,
            a.parallel_group,
            a.delay_ms,
            a.command,
            JSON.stringify(a.params ?? {}),
            a.on_failure,
          ]
        );
      }
      await client.query(`UPDATE scenes SET version = version + 1, updated_at = NOW() WHERE id = $1`, [id]);
      return { ok: true };
    });
  });

  app.patch('/scenes/:id/favorite', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const r = await query(
      `UPDATE scenes SET is_favorite = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, !!body?.is_favorite]
    );
    if (!r.rows[0]) return reply.code(404).send({ error: 'not_found' });
    return r.rows[0];
  });
}
