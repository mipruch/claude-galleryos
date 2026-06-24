/**
 * Kiosk CRUD routes — one row per wall-screen / tablet layout (the admin
 * "Layouts" section). A kiosk is a fixed-pixel canvas of device-widget tiles
 * rendered chromeless at `/kiosk/:name`, so `name` is unique and looked up by
 * the viewer via `GET /kiosks/by-name/:name`.
 *
 *   GET/POST       /api/v1/kiosks
 *   GET            /api/v1/kiosks/by-name/:name
 *   GET/PUT/DELETE /api/v1/kiosks/:id
 */

import { DEFAULT_KIOSK_CONFIG, type KioskConfig, type KioskTile } from "@gallery/types";
import type { ApiContext } from "../context.ts";
import {
  HttpError,
  asObject,
  json,
  noContent,
  paramId,
  readJson,
  requireFields,
  route,
  type RouteMap,
} from "../http.ts";

/** Coerce to a positive integer within [min, max] or throw 400. */
function posInt(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, "BAD_REQUEST", `field '${field}' must be an integer in [${min}, ${max}]`);
  }
  return n;
}

/**
 * Validate + normalize an incoming kiosk `config` (grid geometry + tiles).
 *
 * Permissive about extra keys but strict about the shape the builder/viewer
 * rely on: positive `columns`/`cellHeight`, and every tile carrying a string
 * `deviceId` plus non-negative integer `x/y` and positive `w/h`.
 */
function parseKioskConfig(value: unknown): KioskConfig {
  if (value === undefined) return DEFAULT_KIOSK_CONFIG;
  const obj = asObject(value, "config");
  const columns = posInt(obj.columns ?? DEFAULT_KIOSK_CONFIG.columns, "config.columns", 1, 48);
  const cellHeight = posInt(obj.cellHeight ?? DEFAULT_KIOSK_CONFIG.cellHeight, "config.cellHeight", 8, 1000);
  const rawTiles = obj.tiles ?? [];
  if (!Array.isArray(rawTiles)) {
    throw new HttpError(400, "BAD_REQUEST", "field 'config.tiles' must be an array");
  }
  const tiles: KioskTile[] = rawTiles.map((raw, i) => {
    const t = asObject(raw, `config.tiles[${i}]`);
    if (typeof t.deviceId !== "string" || t.deviceId === "") {
      throw new HttpError(400, "BAD_REQUEST", `config.tiles[${i}].deviceId is required`);
    }
    return {
      id: typeof t.id === "string" && t.id !== "" ? t.id : crypto.randomUUID(),
      deviceId: t.deviceId,
      x: posInt(t.x ?? 0, `config.tiles[${i}].x`, 0, 1000),
      y: posInt(t.y ?? 0, `config.tiles[${i}].y`, 0, 100000),
      w: posInt(t.w ?? 1, `config.tiles[${i}].w`, 1, columns),
      h: posInt(t.h ?? 1, `config.tiles[${i}].h`, 1, 1000),
    };
  });
  return { columns, cellHeight, tiles };
}

/** Map a Postgres unique-name violation to a clean 409 instead of a raw 500. */
function rethrowNameConflict(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("idx_kiosks_name") || msg.includes("duplicate key")) {
    throw new HttpError(409, "CONFLICT", "a kiosk with that name already exists");
  }
  throw err;
}

/**
 * Configures HTTP routes for managing kiosk layouts.
 *
 * @returns A route map with handlers for kiosk CRUD + name lookup.
 */
export function kiosksRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/kiosks": {
      GET: route(async () => json(await ctx.kiosks.list())),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name", "width", "height"]);
        try {
          const created = await ctx.kiosks.create({
            name: String(body.name),
            width: posInt(body.width, "width", 1, 20000),
            height: posInt(body.height, "height", 1, 20000),
            config: parseKioskConfig(body.config),
          });
          return json(created, 201);
        } catch (err) {
          rethrowNameConflict(err);
        }
      }),
    },
    "/api/v1/kiosks/by-name/:name": {
      GET: route(async (req) => {
        const name = decodeURIComponent((req.params as { name: string }).name);
        const kiosk = await ctx.kiosks.getByName(name);
        if (!kiosk) throw new HttpError(404, "NOT_FOUND", "kiosk not found");
        return json(kiosk);
      }),
    },
    "/api/v1/kiosks/:id": {
      GET: route(async (req) => {
        const kiosk = await ctx.kiosks.get(paramId(req));
        if (!kiosk) throw new HttpError(404, "NOT_FOUND", "kiosk not found");
        return json(kiosk);
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        try {
          const updated = await ctx.kiosks.update(paramId(req), {
            name: body.name === undefined ? undefined : String(body.name),
            width: body.width === undefined ? undefined : posInt(body.width, "width", 1, 20000),
            height: body.height === undefined ? undefined : posInt(body.height, "height", 1, 20000),
            config: body.config === undefined ? undefined : parseKioskConfig(body.config),
          });
          if (!updated) throw new HttpError(404, "NOT_FOUND", "kiosk not found");
          return json(updated);
        } catch (err) {
          rethrowNameConflict(err);
        }
      }),
      DELETE: route(async (req) => {
        const removed = await ctx.kiosks.remove(paramId(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "kiosk not found");
        return noContent();
      }),
    },
  };
}
