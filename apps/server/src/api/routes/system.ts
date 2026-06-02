/**
 * System routes — health and diagnostics.
 *   GET /api/v1/system/status   overall health
 *   GET /api/v1/system/drivers  per-connection driver subprocess status
 *   GET /health                 liveness probe
 */

import { driverRegistry } from "../../core/DriverRegistry.ts";
import type { ApiContext } from "../context.ts";
import { json, route, type RouteMap } from "../http.ts";

export function systemRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/system/status": {
      GET: route(() => {
        const drivers = ctx.deviceManager.driverStatuses();
        return json({
          status: "ok",
          uptimeMs: Date.now() - ctx.startedAt,
          installedDrivers: driverRegistry.list().length,
          connections: {
            running: drivers.length,
            connected: drivers.filter((d) => d.connected).length,
          },
        });
      }),
    },
    "/api/v1/system/drivers": {
      GET: route(() => json(ctx.deviceManager.driverStatuses())),
    },
    "/health": {
      GET: route(() => json({ status: "ok" })),
    },
  };
}
