/**
 * Logs routes — read-only access to the TimescaleDB `logs` hypertable plus
 * scene execution history.
 *
 *   GET /api/v1/logs            filtered, paginated log list
 *   GET /api/v1/logs/stats      counts by level for the last 24 h and 7 d
 *   GET /api/v1/logs/executions scene execution history (outcome + duration)
 */

import type { ApiContext } from "../context.ts";
import { HttpError, json, query, route, type RouteMap } from "../http.ts";

/** Parse a positive integer query param, or return the default. Throws 400 on garbage. */
function intParam(req: Bun.BunRequest, key: string, fallback: number): number {
  const raw = query(req, key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new HttpError(400, "BAD_REQUEST", `query param '${key}' must be a non-negative integer`);
  }
  return n;
}

/** Parse an ISO-8601 date query param, or undefined. Throws 400 on an invalid date. */
function dateParam(req: Bun.BunRequest, key: string): Date | undefined {
  const raw = query(req, key);
  if (raw === undefined) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(400, "BAD_REQUEST", `query param '${key}' must be an ISO-8601 date`);
  }
  return d;
}

export function logsRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/logs": {
      GET: route(async (req) => {
        const limit = intParam(req, "limit", 100);
        const offset = intParam(req, "offset", 0);
        const rows = await ctx.logs.list({
          level: query(req, "level"),
          source: query(req, "source"),
          entityId: query(req, "entity_id"),
          from: dateParam(req, "from"),
          to: dateParam(req, "to"),
          limit,
          offset,
        });
        return json({ logs: rows, limit, offset, count: rows.length });
      }),
    },

    "/api/v1/logs/stats": {
      GET: route(async () => {
        const now = Date.now();
        const since24h = new Date(now - 24 * 60 * 60 * 1000);
        const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const [last24h, last7d] = await Promise.all([
          ctx.logs.statsByLevel(since24h),
          ctx.logs.statsByLevel(since7d),
        ]);

        return json({
          last24h: { since: since24h.toISOString(), byLevel: last24h },
          last7d: { since: since7d.toISOString(), byLevel: last7d },
        });
      }),
    },

    "/api/v1/logs/executions": {
      GET: route(async (req) => {
        const limit = intParam(req, "limit", 100);
        const rows = await ctx.sceneExecutions.list({
          sceneId: query(req, "scene_id"),
          status: query(req, "status"),
          limit,
        });
        return json({ executions: rows, limit, count: rows.length });
      }),
    },
  };
}
