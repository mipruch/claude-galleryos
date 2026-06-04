/**
 * Scene routes — CRUD plus execution.
 *
 *   GET    /api/v1/scenes                  list (?room_id= &is_favorite= &tags=)
 *   POST   /api/v1/scenes                  create (with actions[])
 *   GET    /api/v1/scenes/:id              scene + ordered actions
 *   PUT    /api/v1/scenes/:id              replace metadata + actions
 *   DELETE /api/v1/scenes/:id              delete
 *   POST   /api/v1/scenes/:id/execute      run → { executionId, sceneId, status }
 *   POST   /api/v1/scenes/:id/execute/dry-run   simulate (no hardware)
 *   GET    /api/v1/scenes/:id/executions   run history
 *   PATCH  /api/v1/scenes/:id/favorite     { is_favorite }
 */

import type { SceneActionInput } from "@gallery/types";
import {
  SceneConflictError,
  SceneNotFoundError,
  SceneValidationError,
} from "../../core/SceneEngine.ts";
import type { ApiContext } from "../context.ts";
import { HttpError, json, noContent, query, readJson, requireFields, route, type RouteMap } from "../http.ts";

/** Map a thrown SceneEngine error to the right HTTP status. */
function toHttp(err: unknown): never {
  if (err instanceof SceneNotFoundError) throw new HttpError(404, "NOT_FOUND", err.message);
  if (err instanceof SceneConflictError) throw new HttpError(409, "CONFLICT", err.message);
  if (err instanceof SceneValidationError) throw new HttpError(400, "BAD_REQUEST", err.message);
  throw err;
}

/** Coerce a request body's `actions` field into validated SceneActionInput[]. */
function parseActions(raw: unknown): SceneActionInput[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new HttpError(400, "BAD_REQUEST", "`actions` must be an array");
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new HttpError(400, "BAD_REQUEST", `actions[${i}] must be an object`);
    }
    const a = item as Record<string, unknown>;
    if (!a.deviceId || !a.command) {
      throw new HttpError(400, "BAD_REQUEST", `actions[${i}] requires deviceId and command`);
    }
    return {
      deviceId: String(a.deviceId),
      command: String(a.command),
      params: (a.params as Record<string, unknown>) ?? {},
      stepOrder: a.stepOrder !== undefined ? Number(a.stepOrder) : undefined,
      parallelGroup: a.parallelGroup !== undefined ? Number(a.parallelGroup) : undefined,
      delayMs: a.delayMs !== undefined ? Number(a.delayMs) : undefined,
      onFailure: a.onFailure !== undefined ? String(a.onFailure) : undefined,
    };
  });
}

export function scenesRoutes(ctx: ApiContext): RouteMap {
  const id = (req: Bun.BunRequest) => (req.params as { id: string }).id;

  return {
    "/api/v1/scenes": {
      GET: route(async (req) => {
        const isFavoriteRaw = query(req, "is_favorite");
        const tagsRaw = query(req, "tags");
        return json(
          await ctx.scenes.list({
            roomId: query(req, "room_id"),
            isFavorite: isFavoriteRaw === undefined ? undefined : isFavoriteRaw === "true",
            tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
          }),
        );
      }),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name"]);
        const created = await ctx.scenes.create({
          name: String(body.name),
          roomId: (body.roomId as string | undefined) ?? null,
          description: body.description as string | undefined,
          icon: body.icon as string | undefined,
          color: body.color as string | undefined,
          tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
          isFavorite: body.isFavorite as boolean | undefined,
          actions: parseActions(body.actions),
        });
        return json(created, 201);
      }),
    },

    "/api/v1/scenes/:id": {
      GET: route(async (req) => {
        const scene = await ctx.scenes.get(id(req));
        if (!scene) throw new HttpError(404, "NOT_FOUND", "scene not found");
        return json(scene);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        const updated = await ctx.scenes.update(id(req), {
          name: body.name as string | undefined,
          roomId: (body.roomId as string | undefined) ?? undefined,
          description: body.description as string | undefined,
          icon: body.icon as string | undefined,
          color: body.color as string | undefined,
          tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
          isFavorite: body.isFavorite as boolean | undefined,
          actions: parseActions(body.actions),
        });
        if (!updated) throw new HttpError(404, "NOT_FOUND", "scene not found");
        return json(updated);
      }),
      DELETE: route(async (req) => {
        const removed = await ctx.scenes.remove(id(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "scene not found");
        return noContent();
      }),
    },

    "/api/v1/scenes/:id/execute": {
      POST: route(async (req) => {
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        const source = body.source ? String(body.source) : "api";
        try {
          const result = await ctx.sceneEngine.startScene(id(req), source);
          return json(result, 202);
        } catch (err) {
          toHttp(err);
        }
      }),
    },

    "/api/v1/scenes/:id/execute/dry-run": {
      POST: route(async (req) => {
        try {
          return json(await ctx.sceneEngine.dryRun(id(req)));
        } catch (err) {
          toHttp(err);
        }
      }),
    },

    "/api/v1/scenes/:id/executions": {
      GET: route(async (req) => json(await ctx.sceneExecutions.listByScene(id(req)))),
    },

    "/api/v1/scenes/:id/favorite": {
      PATCH: route(async (req) => {
        const body = await readJson(req);
        const isFavorite = Boolean(body.is_favorite ?? body.isFavorite);
        const updated = await ctx.scenes.setFavorite(id(req), isFavorite);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "scene not found");
        return json(updated);
      }),
    },
  };
}
