/**
 * HTTP + WebSocket API server (native Bun.serve).
 *
 * Composes the route modules into Bun's native router, upgrades `/ws` to a
 * WebSocket, and wires EventBus → client broadcasting. Returns the running
 * Server so the composition root can stop it on shutdown.
 */

import type { Server } from "bun";
import { appConfig } from "../config.ts";
import { logger } from "../logger.ts";
import type { ApiContext } from "./context.ts";
import { connectionsRoutes } from "./routes/connections.ts";
import { devicesRoutes } from "./routes/devices.ts";
import { driversRoutes } from "./routes/drivers.ts";
import { iframesRoutes } from "./routes/iframes.ts";
import { logsRoutes } from "./routes/logs.ts";
import { roomsRoutes } from "./routes/rooms.ts";
import { scenesRoutes } from "./routes/scenes.ts";
import { schedulesRoutes } from "./routes/schedules.ts";
import { systemRoutes } from "./routes/system.ts";
import { makeWebSocketHandlers, setupBroadcast } from "./ws.ts";

const log = logger.child("api");

export function startApiServer(ctx: ApiContext, port = appConfig.server.port): Server<unknown> {
  const server = Bun.serve({
    port,
    routes: {
      ...driversRoutes(ctx),
      ...roomsRoutes(ctx),
      ...connectionsRoutes(ctx),
      ...devicesRoutes(ctx),
      ...iframesRoutes(ctx),
      ...systemRoutes(ctx),
      ...logsRoutes(ctx),
      ...scenesRoutes(ctx),
      ...schedulesRoutes(ctx),
      // WebSocket upgrade endpoint.
      "/ws": (req, server) => {
        if (server.upgrade(req, { data: {} })) return undefined;
        return new Response("WebSocket upgrade failed", { status: 426 });
      },
    },
    // Fallback for unmatched paths.
    fetch(req) {
      log.info("request", { method: req.method, path: new URL(req.url).pathname, status: 404 });
      return Response.json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
    },
    websocket: makeWebSocketHandlers(ctx),
    error(err) {
      log.error("unhandled request error", { error: err.message });
      return Response.json({ error: err.message, code: "INTERNAL_ERROR" }, { status: 500 });
    },
  });

  setupBroadcast(server, ctx);
  log.info(`HTTP + WebSocket API listening on http://localhost:${server.port}`, { ws: "/ws" });
  return server;
}
