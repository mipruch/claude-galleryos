/**
 * Driver manifest routes — read-only metadata used to render dynamic forms.
 *   GET /api/v1/drivers
 *   GET /api/v1/drivers/:id/manifest
 */

import type { ApiContext } from "../context.ts";
import { HttpError, paramId, json, route, type RouteMap } from "../http.ts";

/**
 * Creates HTTP route handlers for driver manifest metadata.
 *
 * Defines handlers for:
 * - `GET /api/v1/drivers`: Lists all available drivers.
 * - `GET /api/v1/drivers/:id/manifest`: Retrieves the manifest for a specific driver (returns 404 if not found).
 *
 * @returns A RouteMap containing the route definitions.
 */
export function driversRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/drivers": {
      GET: route(() => json(ctx.driverRegistry.list())),
    },
    "/api/v1/drivers/:id/manifest": {
      GET: route((req) => {
        const id = paramId(req);
        const manifest = ctx.driverRegistry.get(id);
        if (!manifest) throw new HttpError(404, "NOT_FOUND", `driver not found: ${id}`);
        return json(manifest);
      }),
    },
  };
}
