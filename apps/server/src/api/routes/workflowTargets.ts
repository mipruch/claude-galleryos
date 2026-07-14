/**
 * Workflow-target routes — CRUD for the `workflow_targets` placed on the
 * workflow canvas: a scene to run, or a device command to send with its
 * params. A scene/device may have any number of these; each is placed,
 * configured, and deleted independently of the others.
 *
 *   GET    /api/v1/workflow-targets            list all
 *   POST   /api/v1/workflow-targets            create { targetType, targetId, position, … }
 *   GET    /api/v1/workflow-targets/:id        one instance
 *   PUT    /api/v1/workflow-targets/:id        update (command/params/position)
 *   DELETE /api/v1/workflow-targets/:id        delete (cascades its trigger_actions wires)
 *
 * `targetId` must resolve to a real scene/device, so a stale reference is a
 * clean 400 rather than a dispatch-time surprise. `targetType`/`targetId`
 * can't be changed after create (mirrors `trigger_actions`' owner rule) —
 * pointing an instance at something else means placing a new one, not
 * repurposing this one.
 *
 * An update or delete reloads the live {@link InputMapper} cache
 * unconditionally (cheap, and correct whether or not a mapping-owned wire
 * happens to feed this instance) so a params/command edit — or losing a wire
 * to a deleted instance — takes effect immediately, not on the next signal.
 * A create needs no reload: a brand-new instance has no wires yet.
 */

import type { NewWorkflowTarget, TriggerTargetType } from "@gallery/types";
import type { ApiContext } from "../context.ts";
import {
  HttpError,
  asCanvasPosition,
  asObject,
  json,
  noContent,
  paramId,
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

/** `targetId` must resolve to a real scene/device. */
async function assertTargetExists(ctx: ApiContext, targetType: TriggerTargetType, targetId: string): Promise<void> {
  if (targetType === "scene.execute") {
    const scene = await ctx.scenes.get(targetId);
    if (!scene) throw new HttpError(400, "BAD_REQUEST", `scene not found: ${targetId}`);
  } else {
    const device = await ctx.devices.get(targetId);
    if (!device) throw new HttpError(400, "BAD_REQUEST", `device not found: ${targetId}`);
  }
}

export function workflowTargetsRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/workflow-targets": {
      GET: route(async () => json(await ctx.workflowTargets.list())),

      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["targetType", "targetId", "position"]);
        assertTargetType(body.targetType);
        const targetId = String(body.targetId);
        await assertTargetExists(ctx, body.targetType, targetId);

        const position = asCanvasPosition(body.position, "position");
        if (position === null) throw new HttpError(400, "BAD_REQUEST", "position is required");

        const values: NewWorkflowTarget = {
          targetType: body.targetType,
          targetId,
          targetCommand: (body.targetCommand as string | undefined) ?? null,
          params: body.params !== undefined ? asObject(body.params, "params") : {},
          position,
        };
        const created = await ctx.workflowTargets.create(values);
        if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create workflow target");
        return json(created, 201);
      }),
    },

    "/api/v1/workflow-targets/:id": {
      GET: route(async (req) => {
        const target = await ctx.workflowTargets.get(paramId(req));
        if (!target) throw new HttpError(404, "NOT_FOUND", "workflow target not found");
        return json(target);
      }),

      PUT: route(async (req) => {
        const id = paramId(req);
        const body = await readJson(req);
        const current = await ctx.workflowTargets.get(id);
        if (!current) throw new HttpError(404, "NOT_FOUND", "workflow target not found");

        const patch: Partial<NewWorkflowTarget> = {};
        if (body.targetCommand !== undefined) patch.targetCommand = body.targetCommand as string | null;
        if (body.params !== undefined) patch.params = asObject(body.params, "params");
        if (body.position !== undefined) {
          const position = asCanvasPosition(body.position, "position");
          if (position === null) throw new HttpError(400, "BAD_REQUEST", "position cannot be null");
          patch.position = position;
        }

        const updated = await ctx.workflowTargets.update(id, patch);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "workflow target not found");

        await ctx.inputMapper.reload();
        return json(updated);
      }),

      DELETE: route(async (req) => {
        const id = paramId(req);
        const removed = await ctx.workflowTargets.remove(id);
        if (!removed) throw new HttpError(404, "NOT_FOUND", "workflow target not found");
        await ctx.inputMapper.reload(); // cascades away any mapping-owned trigger_actions wired to it
        return noContent();
      }),
    },
  };
}
