/**
 * Device routes — CRUD plus direct control and live state.
 *
 *   GET/POST            /api/v1/devices            (?room_id= &type= &enabled= &connection_id=)
 *   GET/PUT/DELETE      /api/v1/devices/:id
 *   POST                /api/v1/devices/:id/command   { command, params }
 *   GET                 /api/v1/devices/:id/state     (live values, Redis)
 *   GET                 /api/v1/devices/:id/status    (online/offline, Redis)
 *   GET                 /api/v1/devices/live          (state + status for all, one shot)
 */

import type { ApiContext } from "../context.ts";
import {
  HttpError,
  asObject,
  json,
  noContent,
  query,
  readJson,
  requireFields,
  route,
  type RouteMap,
} from "../http.ts";

export function devicesRoutes(ctx: ApiContext): RouteMap {
  const id = (req: Bun.BunRequest) => (req.params as { id: string }).id;

  return {
    "/api/v1/devices": {
      GET: route(async (req) => {
        const enabled = query(req, "enabled");
        const devices = await ctx.devices.list({
          roomId: query(req, "room_id"),
          type: query(req, "type"),
          connectionId: query(req, "connection_id"),
          enabled: enabled === undefined ? undefined : enabled === "true",
        });
        return json(devices);
      }),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["connectionId", "name", "type", "address"]);
        const connection = await ctx.connections.get(String(body.connectionId));
        if (!connection) throw new HttpError(400, "BAD_REQUEST", "connectionId does not exist");

        // Validate the endpoint type (subtype) against the driver's manifest.
        const subtype = body.subtype as string | undefined;
        if (subtype) {
          const manifest = ctx.driverRegistry.get(connection.driverId);
          const known = manifest?.endpointTypes.some((e) => e.type === subtype);
          if (!known) {
            throw new HttpError(400, "BAD_REQUEST", `unknown endpoint type for driver: ${subtype}`);
          }
        }

        const created = await ctx.devices.create({
          connectionId: String(body.connectionId),
          roomId: (body.roomId as string | undefined) ?? null,
          name: String(body.name),
          description: body.description as string | undefined,
          type: String(body.type),
          subtype,
          address: asObject(body.address, "address"),
          capabilities: (body.capabilities as string[] | undefined) ?? [],
          metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
          icon: body.icon as string | undefined,
          enabled: (body.enabled as boolean | undefined) ?? true,
        });
        await ctx.deviceManager.refreshConnectionDevices(created!.connectionId);
        return json(created, 201);
      }),
    },

    // Batched live snapshot for the whole UI: one request instead of 2×N.
    // Returns a map keyed by device id: { [id]: { state, status } }.
    "/api/v1/devices/live": {
      GET: route(async () => {
        const devices = await ctx.devices.list({});
        const entries = await Promise.all(
          devices.map(async (d) => {
            const [state, status] = await Promise.all([
              ctx.state.getDeviceState(d.id),
              ctx.state.getDeviceStatus(d.id),
            ]);
            return [d.id, { state: state ?? {}, status: status ?? { online: false } }] as const;
          }),
        );
        return json(Object.fromEntries(entries));
      }),
    },

    "/api/v1/devices/:id": {
      GET: route(async (req) => {
        const device = await ctx.devices.get(id(req));
        if (!device) throw new HttpError(404, "NOT_FOUND", "device not found");
        return json(device);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        const updated = await ctx.devices.update(id(req), body);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "device not found");
        await ctx.deviceManager.refreshConnectionDevices(updated.connectionId);
        return json(updated);
      }),
      DELETE: route(async (req) => {
        const removed = await ctx.devices.remove(id(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "device not found");
        await ctx.deviceManager.refreshConnectionDevices(removed.connectionId);
        return noContent();
      }),
    },

    "/api/v1/devices/:id/command": {
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["command"]);
        const params = body.params ? asObject(body.params, "params") : {};
        const result = await ctx.deviceManager.execute(id(req), String(body.command), params);
        return json(result);
      }),
    },

    "/api/v1/devices/:id/state": {
      GET: route(async (req) => json((await ctx.state.getDeviceState(id(req))) ?? {})),
    },

    "/api/v1/devices/:id/status": {
      GET: route(async (req) =>
        json((await ctx.state.getDeviceStatus(id(req))) ?? { online: false }),
      ),
    },
  };
}
