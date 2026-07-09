/**
 * Role CRUD routes.
 *
 * A role optionally grants full admin access (`isAdmin`) and/or a set of
 * devices it may see in the User UI (`deviceIds`, backed by the
 * `role_devices` join table — an empty set means the role sees nothing;
 * `isAdmin` roles bypass this and always see everything).
 *
 *   GET/POST       /api/v1/roles
 *   GET/PUT/DELETE /api/v1/roles/:id
 */

import type { ApiContext } from "../context.ts";
import { HttpError, json, noContent, paramId, readJson, requireFields, route, type RouteMap } from "../http.ts";

/** Map a Postgres unique-name violation to a clean 409 instead of a raw 500. */
function rethrowNameConflict(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("idx_roles_name") || msg.includes("duplicate key")) {
    throw new HttpError(409, "CONFLICT", "a role with that name already exists");
  }
  throw err;
}

function parseDeviceIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new HttpError(400, "BAD_REQUEST", "field 'deviceIds' must be an array of strings");
  }
  return value;
}

export function rolesRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/roles": {
      GET: route(async () => json(await ctx.roles.list())),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name"]);
        try {
          const created = await ctx.roles.create(
            {
              name: String(body.name),
              isAdmin: (body.isAdmin as boolean | undefined) ?? false,
              description: (body.description as string | undefined) ?? null,
            },
            parseDeviceIds(body.deviceIds) ?? [],
          );
          return json(created, 201);
        } catch (err) {
          rethrowNameConflict(err);
        }
      }),
    },
    "/api/v1/roles/:id": {
      GET: route(async (req) => {
        const role = await ctx.roles.get(paramId(req));
        if (!role) throw new HttpError(404, "NOT_FOUND", "role not found");
        return json(role);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        try {
          const updated = await ctx.roles.update(
            paramId(req),
            {
              name: body.name as string | undefined,
              isAdmin: body.isAdmin as boolean | undefined,
              description: body.description as string | null | undefined,
            },
            parseDeviceIds(body.deviceIds),
          );
          if (!updated) throw new HttpError(404, "NOT_FOUND", "role not found");
          return json(updated);
        } catch (err) {
          rethrowNameConflict(err);
        }
      }),
      DELETE: route(async (req) => {
        const id = paramId(req);
        if ((await ctx.roles.userCount(id)) > 0) {
          throw new HttpError(409, "CONFLICT", "role has users; reassign them first");
        }
        const removed = await ctx.roles.remove(id);
        if (!removed) throw new HttpError(404, "NOT_FOUND", "role not found");
        return noContent();
      }),
    },
  };
}
