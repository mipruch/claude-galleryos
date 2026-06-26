/**
 * Camera routes — RTSP CCTV sources rendered as live-view sidebar entries.
 *
 * CRUD (admin/seed; no admin UI yet):
 *   GET/POST       /api/v1/cameras
 *   GET/PUT/DELETE /api/v1/cameras/:id
 *
 * On-demand HLS streaming (user UI):
 *   GET  /api/v1/cameras/:id/stream.m3u8   playlist (spawns ffmpeg on first hit)
 *   GET  /api/v1/cameras/:id/seg/:file     a single HLS segment
 *   POST /api/v1/cameras/:id/stop          stop transcoding now (UI unmount)
 *
 * Credentials (`username`/`password`) are write-only: accepted on create/update,
 * never returned. The playlist/segment GETs deliberately bypass the `route()`
 * request logger — the HLS player fetches them every second per viewer, so they
 * would drown the audit log; the StreamManager logs the meaningful lifecycle
 * events (start/stop/idle/crash) instead.
 */

import type { Camera, CameraDTO } from "@gallery/types";
import type { ApiContext } from "../context.ts";
import { HttpError, paramId, json, noContent, readJson, requireFields, route, type RouteMap } from "../http.ts";

const PLAYLIST_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const SEGMENT_CONTENT_TYPE = "video/mp2t";
// Live HLS — never cache the manifest or segments.
const NO_CACHE = "no-cache, no-store, must-revalidate";

/** Strip write-only credentials before a camera row crosses the wire. */
function toPublic(row: Camera): CameraDTO {
  const { username: _u, password: _p, ...pub } = row;
  return pub as unknown as CameraDTO;
}

/** Read the `:file` path parameter (HLS segment name) from a Bun route request. */
const paramFile = (req: Bun.BunRequest): string => (req.params as { file: string }).file;

export function camerasRoutes(ctx: ApiContext): RouteMap {
  /** Serve a file from disk with the given content type, or 404 if it's gone. */
  async function serveFile(path: string, contentType: string): Promise<Response> {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return new Response("not found", { status: 404, headers: { "Cache-Control": NO_CACHE } });
    }
    return new Response(file, {
      headers: { "Content-Type": contentType, "Cache-Control": NO_CACHE },
    });
  }

  return {
    "/api/v1/cameras": {
      GET: route(async () => json((await ctx.cameras.list()).map(toPublic))),
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name", "url"]);
        const created = await ctx.cameras.create({
          name: String(body.name),
          url: String(body.url),
          username: (body.username as string | null | undefined) ?? null,
          password: (body.password as string | null | undefined) ?? null,
          displayOrder: (body.displayOrder as number | undefined) ?? 0,
          enabled: (body.enabled as boolean | undefined) ?? true,
        });
        return json(created ? toPublic(created) : null, 201);
      }),
    },

    "/api/v1/cameras/:id": {
      GET: route(async (req) => {
        const camera = await ctx.cameras.get(paramId(req));
        if (!camera) throw new HttpError(404, "NOT_FOUND", "camera not found");
        return json(toPublic(camera));
      }),
      PUT: route(async (req) => {
        const body = await readJson(req);
        const updated = await ctx.cameras.update(paramId(req), {
          name: body.name as string | undefined,
          url: body.url as string | undefined,
          username: body.username as string | null | undefined,
          password: body.password as string | null | undefined,
          displayOrder: body.displayOrder as number | undefined,
          enabled: body.enabled as boolean | undefined,
        });
        if (!updated) throw new HttpError(404, "NOT_FOUND", "camera not found");
        return json(toPublic(updated));
      }),
      DELETE: route(async (req) => {
        const id = paramId(req);
        // Tear down any live transcoder before the row disappears.
        ctx.streamManager.stop(id, "camera-deleted");
        const removed = await ctx.cameras.remove(id);
        if (!removed) throw new HttpError(404, "NOT_FOUND", "camera not found");
        return noContent();
      }),
    },

    // ── on-demand HLS (unwrapped: high-frequency, self-logged) ──
    "/api/v1/cameras/:id/stream.m3u8": {
      GET: async (req) => {
        const id = paramId(req);
        const camera = await ctx.cameras.get(id);
        if (!camera || !camera.enabled) {
          return new Response("not found", { status: 404, headers: { "Cache-Control": NO_CACHE } });
        }
        ctx.streamManager.ensure(camera);
        const ready = await ctx.streamManager.waitForPlaylist(id);
        if (!ready) {
          return new Response("stream unavailable", {
            status: 503,
            headers: { "Cache-Control": NO_CACHE },
          });
        }
        ctx.streamManager.touch(id);
        return serveFile(ctx.streamManager.playlistPath(id), PLAYLIST_CONTENT_TYPE);
      },
    },

    "/api/v1/cameras/:id/seg/:file": {
      GET: async (req) => {
        const id = paramId(req);
        const path = ctx.streamManager.segmentPath(id, paramFile(req));
        if (!path) {
          return new Response("bad segment", { status: 400, headers: { "Cache-Control": NO_CACHE } });
        }
        // A segment fetch is the player's heartbeat — keep the stream alive.
        ctx.streamManager.touch(id);
        return serveFile(path, SEGMENT_CONTENT_TYPE);
      },
    },

    "/api/v1/cameras/:id/stop": {
      POST: route(async (req) => {
        ctx.streamManager.stop(paramId(req), "client-request");
        return noContent();
      }),
    },
  };
}
