/**
 * Connection routes — CRUD plus runtime DriverHost lifecycle.
 *
 *   GET/POST            /api/v1/connections
 *   GET/PUT/DELETE      /api/v1/connections/:id
 *   POST                /api/v1/connections/:id/connect
 *   POST                /api/v1/connections/:id/disconnect
 *   GET                 /api/v1/connections/:id/status
 *
 * Creating/updating a connection starts/restarts its driver subprocess;
 * deleting or disconnecting stops it. Deleting is blocked (409) while devices
 * still reference the connection.
 */

import type { Connection } from "../../db/schema.ts";
import { toConnectionRecord } from "../../db/repositories.ts";
import type { ApiContext } from "../context.ts";
import { HttpError, json, noContent, readJson, requireFields, route, type RouteMap } from "../http.ts";

export function connectionsRoutes(ctx: ApiContext): RouteMap {
  const id = (req: Bun.BunRequest) => (req.params as { id: string }).id;

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

    "/api/v1/connections/:id": {
      GET: route(async (req) => json(withRuntime(await load(id(req))))),
      PUT: route(async (req) => {
        await load(id(req));
        const body = await readJson(req);
        const updated = await ctx.connections.update(id(req), body);
        // Restart the host so config changes take effect.
        await ctx.deviceManager.stopConnection(updated!.id);
        if (updated!.enabled) await ctx.deviceManager.addConnection(toConnectionRecord(updated!));
        return json(withRuntime(updated!));
      }),
      DELETE: route(async (req) => {
        await load(id(req));
        if ((await ctx.connections.deviceCount(id(req))) > 0) {
          throw new HttpError(409, "CONFLICT", "connection has devices; delete them first");
        }
        await ctx.deviceManager.stopConnection(id(req));
        await ctx.connections.remove(id(req));
        return noContent();
      }),
    },

    "/api/v1/connections/:id/connect": {
      POST: route(async (req) => {
        const row = await load(id(req));
        await ctx.deviceManager.addConnection(toConnectionRecord(row));
        return json({ connectionId: row.id, running: true });
      }),
    },

    "/api/v1/connections/:id/disconnect": {
      POST: route(async (req) => {
        await load(id(req));
        await ctx.deviceManager.stopConnection(id(req));
        return json({ connectionId: id(req), running: false });
      }),
    },

    "/api/v1/connections/:id/status": {
      GET: route(async (req) => {
        const connectionId = id(req);
        await load(connectionId);
        const status = await ctx.state.getConnectionStatus(connectionId);
        return json(status ?? { online: false });
      }),
    },
  };
}
