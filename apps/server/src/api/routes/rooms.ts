/**
 * Room CRUD routes.
 *   GET/POST    /api/v1/rooms
 *   GET/PUT/DELETE /api/v1/rooms/:id
 */

import type { ApiContext } from "../context.ts";
import { HttpError, paramId, json, noContent, readJson, requireFields, route, type RouteMap } from "../http.ts";

export function roomsRoutes(ctx: ApiContext): RouteMap {

  return {
    "/api/v1/rooms": {
      GET: route(async () => json(await ctx.rooms.list())),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name"]);
        const created = await ctx.rooms.create({
          name: String(body.name),
          description: body.description as string | undefined,
          icon: body.icon as string | undefined,
          color: body.color as string | undefined,
          displayOrder: (body.displayOrder as number | undefined) ?? 0,
        });
        return json(created, 201);
      }),
    },
    "/api/v1/rooms/:id": {
      GET: route(async (req) => {
        const room = await ctx.rooms.get(paramId(req));
        if (!room) throw new HttpError(404, "NOT_FOUND", "room not found");
        return json(room);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        const updated = await ctx.rooms.update(paramId(req), {
          name: body.name as string | undefined,
          description: body.description as string | undefined,
          icon: body.icon as string | undefined,
          color: body.color as string | undefined,
          displayOrder: body.displayOrder as number | undefined,
        });
        if (!updated) throw new HttpError(404, "NOT_FOUND", "room not found");
        return json(updated);
      }),
      DELETE: route(async (req) => {
        const removed = await ctx.rooms.remove(paramId(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "room not found");
        return noContent();
      }),
    },
  };
}
