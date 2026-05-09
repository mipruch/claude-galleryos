import type { FastifyInstance } from 'fastify';
import { query } from '../db/index.js';

export default async function logsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/logs', async (req) => {
    const q = req.query as any;
    const where: string[] = [];
    const values: unknown[] = [];
    if (q.level) {
      values.push(q.level);
      where.push(`level = $${values.length}`);
    }
    if (q.source) {
      values.push(q.source);
      where.push(`source = $${values.length}`);
    }
    if (q.entity_id) {
      values.push(q.entity_id);
      where.push(`entity_id = $${values.length}`);
    }
    if (q.from) {
      values.push(q.from);
      where.push(`ts >= $${values.length}`);
    }
    if (q.to) {
      values.push(q.to);
      where.push(`ts <= $${values.length}`);
    }
    const limit = Math.min(Number(q.limit ?? 100), 1000);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const sql = `SELECT * FROM logs ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset}`;
    const r = await query(sql, values);
    return r.rows;
  });

  app.get('/logs/stats', async () => {
    const r = await query(`
      SELECT level,
        SUM(CASE WHEN ts > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END)::int AS last_24h,
        SUM(CASE WHEN ts > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS last_7d
      FROM logs GROUP BY level
    `);
    return r.rows;
  });

  app.get('/logs/executions', async () => {
    const r = await query(`
      SELECT e.*, s.name AS scene_name
      FROM scene_executions e
      LEFT JOIN scenes s ON s.id = e.scene_id
      ORDER BY started_at DESC LIMIT 100
    `);
    return r.rows;
  });
}
