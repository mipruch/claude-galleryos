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
  paramId,
  query,
  readJson,
  requireFields,
  route,
  type RouteMap,
} from "../http.ts";
import { assertValidDeviceAddress } from "../validation.ts";

/**
 * Defines HTTP route handlers for device management operations.
 *
 * Provides endpoints for querying, creating, updating, and deleting devices, as well as
 * executing commands and retrieving live state and status information.
 *
 * @param ctx - The API context providing device, connection, and state management
 * @returns A route map with handlers for device CRUD, command execution, and state queries
 */
export function devicesRoutes(ctx: ApiContext): RouteMap {

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

        // Validate the endpoint type (subtype) + address against the driver's
        // manifest. Both checks are folded into assertValidDeviceAddress, which
        // rejects an unknown endpoint type and a non-conforming address.
        const subtype = body.subtype as string | undefined;
        const address = asObject(body.address, "address");
        if (subtype) assertValidDeviceAddress(connection.driverId, subtype, address);

        const created = await ctx.devices.create({
          connectionId: String(body.connectionId),
          roomId: (body.roomId as string | undefined) ?? null,
          name: String(body.name),
          description: body.description as string | undefined,
          type: String(body.type),
          subtype,
          address,
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
        const device = await ctx.devices.get(paramId(req));
        if (!device) throw new HttpError(404, "NOT_FOUND", "device not found");
        return json(device);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        // Re-validate addressing only when the request touches it. Validates the
        // effective post-update endpoint type + address against the manifest.
        if (body.address !== undefined || body.subtype !== undefined) {
          const existing = await ctx.devices.get(paramId(req));
          if (!existing) throw new HttpError(404, "NOT_FOUND", "device not found");
          const subtype = (body.subtype as string | undefined) ?? existing.subtype ?? undefined;
          const address = (body.address as Record<string, unknown> | undefined) ?? existing.address;
          if (subtype) {
            const connection = await ctx.connections.get(existing.connectionId);
            if (connection) assertValidDeviceAddress(connection.driverId, subtype, asObject(address, "address"));
          }
        }
        const updated = await ctx.devices.update(paramId(req), {
          roomId: body.roomId as string | null | undefined,
          name: body.name as string | undefined,
          description: body.description as string | undefined,
          type: body.type as string | undefined,
          subtype: body.subtype as string | undefined,
          address: body.address as Record<string, unknown> | undefined,
          capabilities: body.capabilities as string[] | undefined,
          metadata: body.metadata as Record<string, unknown> | undefined,
          icon: body.icon as string | undefined,
          displayOrder: body.displayOrder as number | undefined,
          enabled: body.enabled as boolean | undefined,
        });
        if (!updated) throw new HttpError(404, "NOT_FOUND", "device not found");
        await ctx.deviceManager.refreshConnectionDevices(updated.connectionId);
        return json(updated);
      }),
      DELETE: route(async (req) => {
        const removed = await ctx.devices.remove(paramId(req));
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
        const result = await ctx.deviceManager.execute(paramId(req), String(body.command), params);
        return json(result);
      }),
    },

    "/api/v1/devices/:id/state": {
      GET: route(async (req) => json((await ctx.state.getDeviceState(paramId(req))) ?? {})),
    },

    "/api/v1/devices/:id/status": {
      GET: route(async (req) =>
        json((await ctx.state.getDeviceStatus(paramId(req))) ?? { online: false }),
      ),
    },
  };
}
