/**
 * Driver manifest routes — read-only metadata used to render dynamic forms.
 *   GET /api/v1/drivers
 *   GET /api/v1/drivers/:id/manifest
 */

import type { ApiContext } from "../context.ts";
import { HttpError, json, route, type RouteMap } from "../http.ts";

export function driversRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/drivers": {
      GET: route(() => json(ctx.driverRegistry.list())),
    },
    "/api/v1/drivers/:id/manifest": {
      GET: route((req) => {
        const id = (req.params as { id: string }).id;
        const manifest = ctx.driverRegistry.get(id);
        if (!manifest) throw new HttpError(404, "NOT_FOUND", `driver not found: ${id}`);
        return json(manifest);
      }),
    },
  };
}
