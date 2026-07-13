/**
 * Trigger-action routes — CRUD for the `trigger_actions` a schedule or mapping
 * fires (0..N per trigger; an unwired action, dropped on the canvas before a
 * target is picked, is a normal, valid row).
 *
 *   GET    /api/v1/trigger-actions                 list all (?scheduleId= or ?mappingId= to scope)
 *   POST   /api/v1/trigger-actions                  create { scheduleId|mappingId, targetType, … }
 *   GET    /api/v1/trigger-actions/:id              one action
 *   PUT    /api/v1/trigger-actions/:id              update
 *   DELETE /api/v1/trigger-actions/:id              delete
 *
 * Exactly one of `scheduleId`/`mappingId` must name the owner, and it can't be
 * changed after create (mirrors the DB CHECK constraint — an action doesn't
 * switch triggers, it gets deleted and re-created). `targetId`/`targetCommand`
 * are optional (unwired is valid); when a `targetId` IS given it must resolve to
 * a real scene/device, so a stale reference is a clean 400 rather than a dispatch
 * -time surprise.
 *
 * A mutation that touches a mapping-owned action reloads the live
 * {@link InputMapper} cache so wiring changes take effect immediately. A
 * schedule-owned action needs no such reload — the {@link Scheduler} fetches its
 * job's actions fresh from the repo on every fire.
 */

import type { NewTriggerAction, TriggerTargetType } from "@gallery/types";
import type { ApiContext } from "../context.ts";
import {
  HttpError,
  asCanvasPosition,
  asObject,
  json,
  noContent,
  paramId,
  query,
  readJson,
  requireFields,
  route,
  type RouteMap,
} from "../http.ts";

const TARGET_TYPES: readonly TriggerTargetType[] = ["scene.execute", "device.command"];

function assertTargetType(value: unknown): asserts value is TriggerTargetType {
  if (!TARGET_TYPES.includes(value as TriggerTargetType)) {
    throw new HttpError(400, "BAD_REQUEST", `targetType must be one of: ${TARGET_TYPES.join(", ")}`);
  }
}

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

/** If a `targetId` is given, it must resolve to a real scene/device. Unset is valid (unwired). */
async function assertTargetExists(
  ctx: ApiContext,
  targetType: TriggerTargetType,
  targetId: string | null | undefined,
): Promise<void> {
  if (!targetId) return;
  if (targetType === "scene.execute") {
    const scene = await ctx.scenes.get(targetId);
    if (!scene) throw new HttpError(400, "BAD_REQUEST", `scene not found: ${targetId}`);
  } else {
    const device = await ctx.devices.get(targetId);
    if (!device) throw new HttpError(400, "BAD_REQUEST", `device not found: ${targetId}`);
  }
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

/** Normalize `targetId`/`targetCommand` from a request body — both may be explicit `null`. */
function readTargetFields(body: Record<string, unknown>): {
  targetId?: string | null;
  targetCommand?: string | null;
} {
  const out: { targetId?: string | null; targetCommand?: string | null } = {};
  if (body.targetId !== undefined) out.targetId = body.targetId === null ? null : String(body.targetId);
  if (body.targetCommand !== undefined) {
    out.targetCommand = body.targetCommand === null ? null : String(body.targetCommand);
  }
  return out;
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
        requireFields(body, ["targetType"]);
        assertTargetType(body.targetType);
        const owner = assertOwner(body.scheduleId, body.mappingId);
        await assertOwnerExists(ctx, owner);

        const { targetId = null, targetCommand = null } = readTargetFields(body);
        await assertTargetExists(ctx, body.targetType, targetId);

        const values: NewTriggerAction = {
          scheduleId: owner.scheduleId,
          mappingId: owner.mappingId,
          targetType: body.targetType,
          targetId,
          targetCommand,
          ...(body.params !== undefined ? { params: asObject(body.params, "params") } : {}),
          ...(body.position !== undefined ? { position: asCanvasPosition(body.position, "position") } : {}),
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

      PUT: route(async (req) => {
        const id = paramId(req);
        const body = await readJson(req);
        const current = await ctx.triggerActions.get(id);
        if (!current) throw new HttpError(404, "NOT_FOUND", "trigger action not found");

        const patch: Partial<NewTriggerAction> = { ...readTargetFields(body) };
        if (body.targetType !== undefined) {
          assertTargetType(body.targetType);
          patch.targetType = body.targetType;
        }
        if (body.params !== undefined) patch.params = asObject(body.params, "params");
        if (body.position !== undefined) patch.position = asCanvasPosition(body.position, "position");

        // Validate the *effective* target (merge of patch over the current row).
        const effectiveTargetType = patch.targetType ?? current.targetType;
        const effectiveTargetId = patch.targetId !== undefined ? patch.targetId : current.targetId;
        await assertTargetExists(ctx, effectiveTargetType, effectiveTargetId);

        const updated = await ctx.triggerActions.update(id, patch);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "trigger action not found");

        if (current.mappingId) await ctx.inputMapper.reload();
        return json(updated);
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
