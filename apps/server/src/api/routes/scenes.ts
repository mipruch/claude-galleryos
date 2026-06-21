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
import { HttpError, paramId, json, noContent, query, readJson, requireFields, route, type RouteMap } from "../http.ts";

/**
 * Converts SceneEngine errors to HTTP errors with appropriate status codes.
 *
 * - `SceneNotFoundError` → 404
 * - `SceneConflictError` → 409
 * - `SceneValidationError` → 400
 * - Other errors are rethrown unchanged
 */
function toHttp(err: unknown): never {
  if (err instanceof SceneNotFoundError) throw new HttpError(404, "NOT_FOUND", err.message);
  if (err instanceof SceneConflictError) throw new HttpError(409, "CONFLICT", err.message);
  if (err instanceof SceneValidationError) throw new HttpError(400, "BAD_REQUEST", err.message);
  throw err;
}

/**
 * Validates and normalizes action items from a request body into scene action inputs.
 *
 * Each action targets either a child scene via `childSceneId`, or a device via `deviceId` and `command`, but not both. Optional numeric fields (`stepOrder`, `parallelGroup`, `delayMs`) are converted to numbers. The `onFailure` field is accepted only as `"abort"` or `"continue"`.
 *
 * @param raw - The `actions` field from the request body
 * @returns The normalized action list, or `undefined` if the input is `undefined`
 * @throws When the input is not an array, when any action is not an object, or when field constraints are violated
 */
function parseActions(raw: unknown): SceneActionInput[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new HttpError(400, "BAD_REQUEST", "`actions` must be an array");
  return raw.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new HttpError(400, "BAD_REQUEST", `actions[${i}] must be an object`);
    }
    const a = item as Record<string, unknown>;
    // An action targets either a sub-scene (childSceneId) or a device
    // (deviceId + command) — exactly one shape.
    const isSubScene = !!a.childSceneId;
    if (isSubScene) {
      if (a.deviceId || a.command) {
        throw new HttpError(
          400,
          "BAD_REQUEST",
          `actions[${i}] with childSceneId must not set deviceId/command`,
        );
      }
    } else if (!a.deviceId || !a.command) {
      throw new HttpError(400, "BAD_REQUEST", `actions[${i}] requires deviceId and command, or childSceneId`);
    }
    // Reject unknown onFailure values instead of silently dropping them — a typo
    // would otherwise change execution behaviour (fall back to the default).
    if (a.onFailure !== undefined && a.onFailure !== "abort" && a.onFailure !== "continue") {
      throw new HttpError(400, "BAD_REQUEST", `actions[${i}].onFailure must be "abort" or "continue"`);
    }
    return {
      deviceId: isSubScene ? undefined : String(a.deviceId),
      command: isSubScene ? undefined : String(a.command),
      childSceneId: isSubScene ? String(a.childSceneId) : undefined,
      params: (a.params as Record<string, unknown>) ?? {},
      stepOrder: a.stepOrder !== undefined ? Number(a.stepOrder) : undefined,
      parallelGroup: a.parallelGroup !== undefined ? Number(a.parallelGroup) : undefined,
      delayMs: a.delayMs !== undefined ? Number(a.delayMs) : undefined,
      onFailure: a.onFailure as "abort" | "continue" | undefined,
    };
  });
}

/**
 * Creates HTTP routes for scene management including CRUD operations and execution features.
 *
 * @param ctx - The API context providing access to scene services and the scene engine
 * @returns Route definitions mapped to endpoint paths under `/api/v1/scenes`
 */
export function scenesRoutes(ctx: ApiContext): RouteMap {

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
        const scene = await ctx.scenes.get(paramId(req));
        if (!scene) throw new HttpError(404, "NOT_FOUND", "scene not found");
        return json(scene);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        const updated = await ctx.scenes.update(paramId(req), {
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
        const removed = await ctx.scenes.remove(paramId(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "scene not found");
        return noContent();
      }),
    },

    "/api/v1/scenes/:id/execute": {
      POST: route(async (req) => {
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        const source = body.source ? String(body.source) : "api";
        try {
          const result = await ctx.sceneEngine.startScene(paramId(req), source);
          return json(result, 202);
        } catch (err) {
          toHttp(err);
        }
      }),
    },

    "/api/v1/scenes/:id/execute/dry-run": {
      POST: route(async (req) => {
        try {
          return json(await ctx.sceneEngine.dryRun(paramId(req)));
        } catch (err) {
          toHttp(err);
        }
      }),
    },

    "/api/v1/scenes/:id/executions": {
      GET: route(async (req) => json(await ctx.sceneExecutions.listByScene(paramId(req)))),
    },

    "/api/v1/scenes/:id/favorite": {
      PATCH: route(async (req) => {
        const body = await readJson(req);
        // Require an actual boolean — `Boolean("false")` is `true`, so coercion
        // would silently flip the flag for string payloads.
        const isFavorite = body.is_favorite ?? body.isFavorite;
        if (typeof isFavorite !== "boolean") {
          throw new HttpError(400, "BAD_REQUEST", "`is_favorite` must be a boolean");
        }
        const updated = await ctx.scenes.setFavorite(paramId(req), isFavorite);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "scene not found");
        return json(updated);
      }),
    },
  };
}
