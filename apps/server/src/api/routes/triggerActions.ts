/**
 * Trigger-action routes — CRUD for the `trigger_actions` wiring a schedule or
 * mapping to an already-placed `workflow_targets` instance (0..N per
 * trigger, 0..N triggers per instance).
 *
 *   GET    /api/v1/trigger-actions                 list all (?scheduleId= or ?mappingId= to scope)
 *   POST   /api/v1/trigger-actions                  create { scheduleId|mappingId, workflowTargetId }
 *   GET    /api/v1/trigger-actions/:id              one wire
 *   DELETE /api/v1/trigger-actions/:id              delete
 *
 * Exactly one of `scheduleId`/`mappingId` must name the owner, and it can't
 * be changed after create (mirrors the DB CHECK constraint — a wire doesn't
 * switch triggers, it gets deleted and re-created). `workflowTargetId` must
 * resolve to an existing instance, so a stale reference is a clean 400
 * rather than a dispatch-time surprise. There is no PUT: a pure link row has
 * nothing else to configure — see `workflow-targets` for command/params.
 *
 * A mutation that touches a mapping-owned wire reloads the live
 * {@link InputMapper} cache so wiring changes take effect immediately. A
 * schedule-owned wire needs no such reload — the {@link Scheduler} fetches
 * its job's actions fresh from the repo on every fire.
 */

import type { NewTriggerAction } from "@gallery/types";
import type { ApiContext } from "../context.ts";
import { HttpError, json, noContent, paramId, query, readJson, route, type RouteMap } from "../http.ts";

/** Exactly one of scheduleId/mappingId must name the owner. */
function assertOwner(
  scheduleIdRaw: unknown,
  mappingIdRaw: unknown,
): { scheduleId: string | null; mappingId: string | null } {
  const hasSchedule = scheduleIdRaw !== undefined && scheduleIdRaw !== null;
  const hasMapping = mappingIdRaw !== undefined && mappingIdRaw !== null;
  if (hasSchedule === hasMapping) {
    throw new HttpError(400, "BAD_REQUEST", "exactly one of scheduleId or mappingId is required");
  }
  return {
    scheduleId: hasSchedule ? String(scheduleIdRaw) : null,
    mappingId: hasMapping ? String(mappingIdRaw) : null,
  };
}

/** The owner named by a create body must already exist (a clean 400, not an FK-violation 500). */
async function assertOwnerExists(
  ctx: ApiContext,
  owner: { scheduleId: string | null; mappingId: string | null },
): Promise<void> {
  if (owner.scheduleId && !(await ctx.schedules.get(owner.scheduleId))) {
    throw new HttpError(400, "BAD_REQUEST", `schedule not found: ${owner.scheduleId}`);
  }
  if (owner.mappingId && !(await ctx.mappings.get(owner.mappingId))) {
    throw new HttpError(400, "BAD_REQUEST", `mapping not found: ${owner.mappingId}`);
  }
}

export function triggerActionsRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/trigger-actions": {
      GET: route(async (req) => {
        const scheduleId = query(req, "scheduleId");
        const mappingId = query(req, "mappingId");
        if (scheduleId) return json(await ctx.triggerActions.listByScheduleId(scheduleId));
        if (mappingId) return json(await ctx.triggerActions.listByMappingId(mappingId));
        return json(await ctx.triggerActions.list());
      }),

      POST: route(async (req) => {
        const body = await readJson(req);
        if (typeof body.workflowTargetId !== "string" || !body.workflowTargetId) {
          throw new HttpError(400, "BAD_REQUEST", "workflowTargetId is required");
        }
        const owner = assertOwner(body.scheduleId, body.mappingId);
        await assertOwnerExists(ctx, owner);

        const target = await ctx.workflowTargets.get(body.workflowTargetId);
        if (!target) throw new HttpError(400, "BAD_REQUEST", `workflow target not found: ${body.workflowTargetId}`);

        const values: NewTriggerAction = {
          scheduleId: owner.scheduleId,
          mappingId: owner.mappingId,
          workflowTargetId: body.workflowTargetId,
        };
        const created = await ctx.triggerActions.create(values);
        if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create trigger action");

        if (owner.mappingId) await ctx.inputMapper.reload();
        return json(created, 201);
      }),
    },

    "/api/v1/trigger-actions/:id": {
      GET: route(async (req) => {
        const action = await ctx.triggerActions.get(paramId(req));
        if (!action) throw new HttpError(404, "NOT_FOUND", "trigger action not found");
        return json(action);
      }),

      DELETE: route(async (req) => {
        const removed = await ctx.triggerActions.remove(paramId(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "trigger action not found");
        if (removed.mappingId) await ctx.inputMapper.reload();
        return noContent();
      }),
    },
  };
}
