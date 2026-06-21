/**
 * Connection routes — CRUD plus runtime DriverHost lifecycle.
 *
 *   GET/POST            /api/v1/connections
 *   GET/PUT/DELETE      /api/v1/connections/:id
 *   POST                /api/v1/connections/:id/connect
 *   POST                /api/v1/connections/:id/disconnect
 *   GET                 /api/v1/connections/:id/status
 *   GET                 /api/v1/connections/live   (status for all, one shot)
 *
 * Creating/updating a connection starts/restarts its driver subprocess;
 * deleting or disconnecting stops it. Deleting is blocked (409) while devices
 * still reference the connection.
 */

import type { Connection } from "@gallery/types";
import { toConnectionRecord } from "../../db/repositories.ts";
import type { ApiContext } from "../context.ts";
import { HttpError, paramId, json, noContent, readJson, requireFields, route, type RouteMap } from "../http.ts";
import { assertValidConnectionConfig } from "../validation.ts";

/** Effective value of a PUT field: `undefined` keeps the current value. */
const effective = <T>(patch: T | null | undefined, current: T | null): T | null =>
  patch === undefined ? current : patch;

export function connectionsRoutes(ctx: ApiContext): RouteMap {

  /** Attach the live `running` flag to a connection row. */
  const withRuntime = (row: Connection) => ({
    ...row,
    running: ctx.deviceManager.isConnectionRunning(row.id),
  });

  const load = async (connectionId: string): Promise<Connection> => {
    const row = await ctx.connections.get(connectionId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "connection not found");
    return row;
  };

  return {
    "/api/v1/connections": {
      GET: route(async () => json((await ctx.connections.list()).map(withRuntime))),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name", "driverId"]);
        const driverId = String(body.driverId);
        if (!ctx.driverRegistry.has(driverId)) {
          throw new HttpError(400, "BAD_REQUEST", `unknown driver: ${driverId}`);
        }
        const config = (body.config as Record<string, unknown> | undefined) ?? {};
        // host/port are dedicated columns — they must win over any same-named
        // keys in the freeform config blob, so spread config first.
        assertValidConnectionConfig(driverId, {
          ...config,
          host: body.host ?? undefined,
          port: body.port ?? undefined,
        });
        const created = await ctx.connections.create({
          name: String(body.name),
          driverId,
          host: (body.host as string | undefined) ?? null,
          port: (body.port as number | undefined) ?? null,
          protocol: (body.protocol as string | undefined) ?? "tcp",
          config: (body.config as Record<string, unknown> | undefined) ?? {},
          enabled: (body.enabled as boolean | undefined) ?? true,
        });
        if (created?.enabled) await ctx.deviceManager.addConnection(toConnectionRecord(created));
        return json(withRuntime(created!), 201);
      }),
    },

    // Batched live snapshot for the whole UI: one request instead of N.
    // Returns a map keyed by connection id: { [id]: ConnectionStatus }.
    "/api/v1/connections/live": {
      GET: route(async () => {
        const rows = await ctx.connections.list();
        const entries = await Promise.all(
          rows.map(async (row) => {
            const status = await ctx.state.getConnectionStatus(row.id);
            return [row.id, status ?? { online: false }] as const;
          }),
        );
        return json(Object.fromEntries(entries));
      }),
    },

    "/api/v1/connections/:id": {
      GET: route(async (req) => json(withRuntime(await load(paramId(req))))),
      PUT: route(async (req) => {
        const existing = await load(paramId(req));
        const body = await readJson(req);
        // Validate the post-update state: a partial PUT must still leave a
        // connection whose config satisfies the (possibly new) driver's schema.
        const driverId = (body.driverId as string | undefined) ?? existing.driverId;
        const config =
          (body.config as Record<string, unknown> | undefined) ?? (existing.config as Record<string, unknown>) ?? {};
        // host/port are dedicated columns — spread config first so they win.
        assertValidConnectionConfig(driverId, {
          ...config,
          host: effective(body.host as string | null | undefined, existing.host) ?? undefined,
          port: effective(body.port as number | null | undefined, existing.port) ?? undefined,
        });
        const updated = await ctx.connections.update(paramId(req), {
          name: body.name as string | undefined,
          driverId: body.driverId as string | undefined,
          host: body.host as string | null | undefined,
          port: body.port as number | null | undefined,
          protocol: body.protocol as string | undefined,
          config: body.config as Record<string, unknown> | undefined,
          enabled: body.enabled as boolean | undefined,
        });
        if (!updated) throw new HttpError(404, "NOT_FOUND", "connection not found");
        // Restart the host so config changes take effect.
        await ctx.deviceManager.stopConnection(updated.id);
        if (updated.enabled) await ctx.deviceManager.addConnection(toConnectionRecord(updated));
        return json(withRuntime(updated));
      }),
      DELETE: route(async (req) => {
        await load(paramId(req));
        if ((await ctx.connections.deviceCount(paramId(req))) > 0) {
          throw new HttpError(409, "CONFLICT", "connection has devices; delete them first");
        }
        await ctx.deviceManager.stopConnection(paramId(req));
        await ctx.connections.remove(paramId(req));
        return noContent();
      }),
    },

    "/api/v1/connections/:id/connect": {
      POST: route(async (req) => {
        const row = await load(paramId(req));
        await ctx.deviceManager.addConnection(toConnectionRecord(row));
        return json({ connectionId: row.id, running: true });
      }),
    },

    "/api/v1/connections/:id/disconnect": {
      POST: route(async (req) => {
        await load(paramId(req));
        await ctx.deviceManager.stopConnection(paramId(req));
        return json({ connectionId: paramId(req), running: false });
      }),
    },

    "/api/v1/connections/:id/status": {
      GET: route(async (req) => {
        const connectionId = paramId(req);
        await load(connectionId);
        const status = await ctx.state.getConnectionStatus(connectionId);
        return json(status ?? { online: false });
      }),
    },
  };
}
