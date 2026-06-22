/**
 * Schedule routes — CRUD for CRON jobs plus a next-runs preview.
 *
 *   GET    /api/v1/schedules              list all jobs
 *   POST   /api/v1/schedules             create { name, sceneId, cron, timezone?, enabled? }
 *   GET    /api/v1/schedules/:id         one job
 *   PUT    /api/v1/schedules/:id         update (reloads the live timer)
 *   DELETE /api/v1/schedules/:id         delete (unregisters the timer)
 *   PATCH  /api/v1/schedules/:id/toggle  enable/disable without delete
 *   GET    /api/v1/schedules/:id/next    next N (default 5) UTC fire times
 *
 * A create/update/toggle/delete mutates the DB *and* the live Scheduler so cron
 * changes take effect without a server restart. Cron expressions and timezones
 * are validated up front (→ 400) so a bad schedule never reaches the Scheduler.
 *
 * All persisted/returned timestamps are UTC (`timestamptz`); the per-job
 * `timezone` only governs how the cron expression is interpreted. Display logic
 * converts the UTC `nextRuns` / `next_run_at` to local time.
 */

import type { ScheduleNextRuns } from "@gallery/types";
import type { ApiContext } from "../context.ts";
import { CronParseError, computeNextRuns, parseCron } from "../../core/cron.ts";
import {
  HttpError,
  json,
  noContent,
  paramId,
  query,
  readJson,
  requireFields,
  route,
  type RouteMap,
} from "../http.ts";

/** Most fire-time previews a client could sensibly want. */
const MAX_NEXT = 50;
const DEFAULT_NEXT = 5;

/** Validate a 5-field cron expression, surfacing the parser message as a 400. */
function assertValidCron(cron: string): void {
  try {
    parseCron(cron);
  } catch (err) {
    const msg = err instanceof CronParseError ? err.message : "invalid cron expression";
    throw new HttpError(400, "BAD_REQUEST", msg);
  }
}

/** Validate an IANA timezone via Intl (the only portable check), else 400. */
function assertValidTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new HttpError(400, "BAD_REQUEST", `invalid timezone: "${tz}"`);
  }
}

/**
 * Builds the schedule (CRON job) routes, keeping the persisted jobs and the live
 * Scheduler in sync on every mutation.
 */
export function schedulesRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/schedules": {
      GET: route(async () => json(await ctx.schedules.list())),

      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name", "sceneId", "cron"]);
        const cron = String(body.cron);
        assertValidCron(cron);
        const timezone = body.timezone !== undefined ? String(body.timezone) : undefined;
        if (timezone !== undefined) assertValidTimezone(timezone);

        // Fail with a clean 400 rather than a raw FK-violation 500.
        const scene = await ctx.scenes.get(String(body.sceneId));
        if (!scene) throw new HttpError(400, "BAD_REQUEST", `scene not found: ${body.sceneId}`);

        if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
          throw new HttpError(400, "BAD_REQUEST", "enabled must be a boolean");
        }

        const created = await ctx.schedules.create({
          name: String(body.name),
          sceneId: String(body.sceneId),
          cron,
          ...(timezone !== undefined ? { timezone } : {}),
          enabled: body.enabled as boolean | undefined,
        });
        if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create schedule");

        // Arm the live timer (no-op if the job was created disabled).
        ctx.scheduler.addJob(created);
        return json(created, 201);
      }),
    },

    "/api/v1/schedules/:id": {
      GET: route(async (req) => {
        const job = await ctx.schedules.get(paramId(req));
        if (!job) throw new HttpError(404, "NOT_FOUND", "schedule not found");
        return json(job);
      }),

      PUT: route(async (req) => {
        const id = paramId(req);
        const body = await readJson(req);

        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) patch.name = String(body.name);
        if (body.sceneId !== undefined) {
          const scene = await ctx.scenes.get(String(body.sceneId));
          if (!scene) throw new HttpError(400, "BAD_REQUEST", `scene not found: ${body.sceneId}`);
          patch.sceneId = String(body.sceneId);
        }
        if (body.cron !== undefined) {
          assertValidCron(String(body.cron));
          patch.cron = String(body.cron);
        }
        if (body.timezone !== undefined) {
          assertValidTimezone(String(body.timezone));
          patch.timezone = String(body.timezone);
        }
        if (body.enabled !== undefined) {
          if (typeof body.enabled !== "boolean") {
            throw new HttpError(400, "BAD_REQUEST", "enabled must be a boolean");
          }
          patch.enabled = body.enabled;
        }

        const updated = await ctx.schedules.update(id, patch);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "schedule not found");

        // Re-arm from the fresh DB state (schedules if enabled, cancels if not).
        await ctx.scheduler.reloadJob(id);
        return json(updated);
      }),

      DELETE: route(async (req) => {
        const id = paramId(req);
        const removed = await ctx.schedules.remove(id);
        if (!removed) throw new HttpError(404, "NOT_FOUND", "schedule not found");
        ctx.scheduler.removeJob(id);
        return noContent();
      }),
    },

    "/api/v1/schedules/:id/toggle": {
      PATCH: route(async (req) => {
        const id = paramId(req);
        // Only a truly empty body means "flip"; malformed JSON is a 400, not a
        // silent toggle.
        const raw = (await req.text()).trim();
        let body: Record<string, unknown> = {};
        if (raw !== "") {
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            throw new HttpError(400, "BAD_REQUEST", "invalid JSON body");
          }
        }
        if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
          throw new HttpError(400, "BAD_REQUEST", "enabled must be a boolean");
        }

        const current = await ctx.schedules.get(id);
        if (!current) throw new HttpError(404, "NOT_FOUND", "schedule not found");

        // Explicit `enabled` sets that state; omitting it flips the current value.
        const enabled = typeof body.enabled === "boolean" ? body.enabled : !current.enabled;

        const updated = await ctx.schedules.setEnabled(id, enabled);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "schedule not found");

        await ctx.scheduler.reloadJob(id);
        return json(updated);
      }),
    },

    "/api/v1/schedules/:id/next": {
      GET: route(async (req) => {
        const job = await ctx.schedules.get(paramId(req));
        if (!job) throw new HttpError(404, "NOT_FOUND", "schedule not found");

        const countRaw = query(req, "count");
        const count = countRaw ? Math.min(Math.max(Number(countRaw) || DEFAULT_NEXT, 1), MAX_NEXT) : DEFAULT_NEXT;

        // Stored cron should already be valid, but guard so a hand-edited row
        // yields a 400 rather than a 500.
        let runs: string[];
        try {
          runs = computeNextRuns(job.cron, job.timezone, count).map((d) => d.toISOString());
        } catch (err) {
          const msg = err instanceof CronParseError ? err.message : "invalid schedule";
          throw new HttpError(400, "BAD_REQUEST", msg);
        }

        const preview: ScheduleNextRuns = {
          id: job.id,
          cron: job.cron,
          timezone: job.timezone,
          nextRuns: runs,
        };
        return json(preview);
      }),
    },
  };
}
