/**
 * Camera CRUD routes — one row per camera feed reference (no control, no position).
 *   GET/POST       /api/v1/cameras
 *   GET/PUT/DELETE /api/v1/cameras/:id
 */

import type { ApiContext } from "../context.ts";
import { HttpError, paramId, json, noContent, readJson, requireFields, route, type RouteMap } from "../http.ts";

/**
 * Configures HTTP routes for managing camera entries.
 *
 * @returns A route map with handlers for camera CRUD operations.
 */
export function camerasRoutes(ctx: ApiContext): RouteMap {

  return {
    "/api/v1/cameras": {
      GET: route(async () => json(await ctx.cameras.list())),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name", "url"]);
        const created = await ctx.cameras.create({
          name: String(body.name),
          description: (body.description as string | undefined) ?? null,
          icon: (body.icon as string | undefined) ?? null,
          url: String(body.url),
          username: (body.username as string | undefined) ?? null,
          password: (body.password as string | undefined) ?? null,
        });
        return json(created, 201);
      }),
    },
    "/api/v1/cameras/:id": {
      GET: route(async (req) => {
        const camera = await ctx.cameras.get(paramId(req));
        if (!camera) throw new HttpError(404, "NOT_FOUND", "camera not found");
        return json(camera);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        const updated = await ctx.cameras.update(paramId(req), {
          name: body.name as string | undefined,
          description: body.description as string | undefined,
          icon: body.icon as string | undefined,
          url: body.url as string | undefined,
          username: body.username as string | undefined,
          password: body.password as string | undefined,
        });
        if (!updated) throw new HttpError(404, "NOT_FOUND", "camera not found");
        return json(updated);
      }),
      DELETE: route(async (req) => {
        const removed = await ctx.cameras.remove(paramId(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "camera not found");
        return noContent();
      }),
    },
  };
}
