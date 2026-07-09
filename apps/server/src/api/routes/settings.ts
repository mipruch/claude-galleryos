/**
 * Security settings — currently just the front-end inactivity-logout
 * timeout, admin-editable from Settings > Security. Backed by the existing
 * `config` key/value table (nothing else in this codebase reads/writes it
 * yet), so a value set here applies immediately without a restart.
 *
 *   GET/PUT /api/v1/settings/security
 */

import { appConfig } from "../../config.ts";
import type { ApiContext } from "../context.ts";
import { HttpError, json, readJson, route, type RouteMap } from "../http.ts";

const SESSION_TIMEOUT_KEY = "auth.session_timeout_minutes";

export function settingsRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/settings/security": {
      GET: route(async () => {
        const row = await ctx.config.get(SESSION_TIMEOUT_KEY);
        const sessionTimeoutMinutes =
          typeof row?.value === "number" ? row.value : appConfig.auth.defaultSessionTimeoutMinutes;
        return json({ sessionTimeoutMinutes });
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        const minutes = Number(body.sessionTimeoutMinutes);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
          throw new HttpError(400, "BAD_REQUEST", "sessionTimeoutMinutes must be between 1 and 1440");
        }
        await ctx.config.set(SESSION_TIMEOUT_KEY, minutes);
        return json({ sessionTimeoutMinutes: minutes });
      }),
    },
  };
}
