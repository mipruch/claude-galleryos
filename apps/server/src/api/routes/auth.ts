/**
 * Login route.
 *
 * This is a one-shot credential check — no cookie, no token, no server-side
 * session. The frontend remembers the returned user + role locally just to
 * decide what to render (which admin sections are reachable); which devices
 * show up is decided fresh by the server on every fetch (`?role_id=`, see
 * `routes/devices.ts`), so the login response doesn't need to carry
 * `deviceIds` — nothing caches it. The HTTP API and WebSocket stay exactly as
 * open as every other route in this codebase (see PLAN.md "Priority 6").
 *
 *   POST /api/v1/auth/login
 */

import type { ApiContext } from "../context.ts";
import { HttpError, json, readJson, requireFields, route, type RouteMap } from "../http.ts";

// Same message for "no such user", "wrong password", and "disabled account" —
// cheap hygiene against username enumeration.
const INVALID_CREDENTIALS = "invalid username or password";

export function authRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/auth/login": {
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["username", "password"]);
        const username = String(body.username);
        const password = String(body.password);

        const user = await ctx.users.getByUsername(username);
        if (!user || !user.enabled) throw new HttpError(401, "UNAUTHORIZED", INVALID_CREDENTIALS);

        const valid = await Bun.password.verify(password, user.passwordHash);
        if (!valid) throw new HttpError(401, "UNAUTHORIZED", INVALID_CREDENTIALS);

        const role = await ctx.roles.get(user.roleId);
        if (!role) throw new HttpError(401, "UNAUTHORIZED", INVALID_CREDENTIALS);

        return json({
          user: { id: user.id, username: user.username, displayName: user.displayName },
          role: { id: role.id, name: role.name, isAdmin: role.isAdmin },
        });
      }),
    },
  };
}
