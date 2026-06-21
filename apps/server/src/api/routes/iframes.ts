/**
 * Iframe CRUD routes — one row per embedded device UI (sidebar entry).
 *   GET/POST       /api/v1/iframes
 *   GET/PUT/DELETE /api/v1/iframes/:id
 */

import type { ApiContext } from "../context.ts";
import { HttpError, paramId, json, noContent, readJson, requireFields, route, type RouteMap } from "../http.ts";

/**
 * Configures HTTP routes for managing embedded iframe entries.
 *
 * @returns A route map with handlers for iframe CRUD operations.
 */
export function iframesRoutes(ctx: ApiContext): RouteMap {

  return {
    "/api/v1/iframes": {
      GET: route(async () => json(await ctx.iframes.list())),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name", "url"]);
        const created = await ctx.iframes.create({
          name: String(body.name),
          url: String(body.url),
          displayOrder: (body.displayOrder as number | undefined) ?? 0,
        });
        return json(created, 201);
      }),
    },
    "/api/v1/iframes/:id": {
      GET: route(async (req) => {
        const iframe = await ctx.iframes.get(paramId(req));
        if (!iframe) throw new HttpError(404, "NOT_FOUND", "iframe not found");
        return json(iframe);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        const updated = await ctx.iframes.update(paramId(req), {
          name: body.name as string | undefined,
          url: body.url as string | undefined,
          displayOrder: body.displayOrder as number | undefined,
        });
        if (!updated) throw new HttpError(404, "NOT_FOUND", "iframe not found");
        return json(updated);
      }),
      DELETE: route(async (req) => {
        const removed = await ctx.iframes.remove(paramId(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "iframe not found");
        return noContent();
      }),
    },
  };
}
