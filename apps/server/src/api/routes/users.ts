/**
 * User CRUD routes — admin creates every account, no self-registration.
 *
 * Passwords are hashed with `Bun.password` (argon2id) before they touch the
 * DB and the hash never crosses back over the wire (`toPublic` strips it,
 * mirroring how `cameras.ts` strips RTSP credentials).
 *
 *   GET/POST       /api/v1/users
 *   GET/PUT/DELETE /api/v1/users/:id
 */

import type { User, UserDTO } from "@gallery/types";
import type { ApiContext } from "../context.ts";
import { HttpError, json, noContent, paramId, readJson, requireFields, route, type RouteMap } from "../http.ts";

const MIN_PASSWORD_LENGTH = 6;

/** Strip the password hash before a user row crosses the wire. */
function toPublic(row: User): UserDTO {
  const { passwordHash: _passwordHash, ...pub } = row;
  return pub as unknown as UserDTO;
}

/** Map a Postgres unique-username violation to a clean 409 instead of a raw 500. */
function rethrowUsernameConflict(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("idx_users_username") || msg.includes("duplicate key")) {
    throw new HttpError(409, "CONFLICT", "a user with that username already exists");
  }
  throw err;
}

function assertPasswordLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, "BAD_REQUEST", `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export function usersRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/users": {
      GET: route(async () => json((await ctx.users.list()).map(toPublic))),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["username", "password", "roleId"]);
        const password = String(body.password);
        assertPasswordLength(password);
        const role = await ctx.roles.get(String(body.roleId));
        if (!role) throw new HttpError(400, "BAD_REQUEST", "unknown roleId");
        try {
          const created = await ctx.users.create({
            username: String(body.username),
            passwordHash: await Bun.password.hash(password),
            roleId: role.id,
            displayName: (body.displayName as string | undefined) ?? null,
            enabled: (body.enabled as boolean | undefined) ?? true,
          });
          return json(created ? toPublic(created) : null, 201);
        } catch (err) {
          rethrowUsernameConflict(err);
        }
      }),
    },
    "/api/v1/users/:id": {
      GET: route(async (req) => {
        const user = await ctx.users.get(paramId(req));
        if (!user) throw new HttpError(404, "NOT_FOUND", "user not found");
        return json(toPublic(user));
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        if (body.roleId !== undefined) {
          const role = await ctx.roles.get(String(body.roleId));
          if (!role) throw new HttpError(400, "BAD_REQUEST", "unknown roleId");
        }
        let passwordHash: string | undefined;
        if (body.password !== undefined && body.password !== "") {
          const password = String(body.password);
          assertPasswordLength(password);
          passwordHash = await Bun.password.hash(password);
        }
        try {
          const updated = await ctx.users.update(paramId(req), {
            username: body.username as string | undefined,
            passwordHash,
            roleId: body.roleId as string | undefined,
            displayName: body.displayName as string | null | undefined,
            enabled: body.enabled as boolean | undefined,
          });
          if (!updated) throw new HttpError(404, "NOT_FOUND", "user not found");
          return json(toPublic(updated));
        } catch (err) {
          rethrowUsernameConflict(err);
        }
      }),
      DELETE: route(async (req) => {
        const removed = await ctx.users.remove(paramId(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "user not found");
        return noContent();
      }),
    },
  };
}
