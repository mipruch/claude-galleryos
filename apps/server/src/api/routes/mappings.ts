/**
 * Input-mapping routes — CRUD for the OSC/TCP/HTTP ingress rules plus a dry-run
 * matcher.
 *
 *   GET    /api/v1/mappings              list all rules (?protocol= ?enabled=)
 *   POST   /api/v1/mappings              create { name, protocol, pattern, targetType, … }
 *   GET    /api/v1/mappings/:id          one rule
 *   PUT    /api/v1/mappings/:id          update
 *   DELETE /api/v1/mappings/:id          delete
 *   PATCH  /api/v1/mappings/:id/toggle   enable/disable without delete
 *   POST   /api/v1/mappings/test         { protocol, address, args? } → matches (no dispatch)
 *
 * Every mutation writes the DB *and* reloads the live {@link InputMapper} cache so
 * changes take effect without a restart. Targets are validated up front: the
 * referenced scene/device must exist, and `targetType` decides which of
 * `targetId`/`targetCommand` are required (→ 400) — so a bad rule never reaches
 * the matcher.
 */

import type {
  InputMappingTestResult,
  InputProtocol,
  InputTargetType,
  NewInputMapping,
} from "@gallery/types";
import type { ApiContext } from "../context.ts";
import {
  HttpError,
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

const PROTOCOLS: readonly InputProtocol[] = ["osc", "tcp", "http"];
const TARGET_TYPES: readonly InputTargetType[] = ["scene.execute", "device.command", "event.emit"];

function assertProtocol(value: unknown): asserts value is InputProtocol {
  if (!PROTOCOLS.includes(value as InputProtocol)) {
    throw new HttpError(400, "BAD_REQUEST", `protocol must be one of: ${PROTOCOLS.join(", ")}`);
  }
}

function assertTargetType(value: unknown): asserts value is InputTargetType {
  if (!TARGET_TYPES.includes(value as InputTargetType)) {
    throw new HttpError(400, "BAD_REQUEST", `targetType must be one of: ${TARGET_TYPES.join(", ")}`);
  }
}

/**
 * Validate that the target referenced by a (possibly partial) rule exists and
 * carries the fields its `targetType` needs. `targetType`/`targetId`/
 * `targetCommand` may come from the request or the existing row (on PUT).
 */
async function assertTargetResolvable(
  ctx: ApiContext,
  targetType: InputTargetType,
  targetId: string | null | undefined,
  targetCommand: string | null | undefined,
): Promise<void> {
  if (targetType === "scene.execute") {
    if (!targetId) throw new HttpError(400, "BAD_REQUEST", "scene.execute requires targetId");
    const scene = await ctx.scenes.get(targetId);
    if (!scene) throw new HttpError(400, "BAD_REQUEST", `scene not found: ${targetId}`);
  } else if (targetType === "device.command") {
    if (!targetId || !targetCommand) {
      throw new HttpError(400, "BAD_REQUEST", "device.command requires targetId and targetCommand");
    }
    const device = await ctx.devices.get(targetId);
    if (!device) throw new HttpError(400, "BAD_REQUEST", `device not found: ${targetId}`);
  }
  // event.emit needs no concrete target.
}

export function mappingsRoutes(ctx: ApiContext): RouteMap {
  return {
    "/api/v1/mappings": {
      GET: route(async (req) => {
        const protocol = query(req, "protocol");
        if (protocol !== undefined) assertProtocol(protocol);
        const enabledRaw = query(req, "enabled");
        const enabled = enabledRaw === undefined ? undefined : enabledRaw === "true";
        return json(await ctx.mappings.list({ protocol, enabled }));
      }),

      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["name", "protocol", "pattern", "targetType"]);
        assertProtocol(body.protocol);
        assertTargetType(body.targetType);

        const targetId = body.targetId !== undefined && body.targetId !== null ? String(body.targetId) : null;
        const targetCommand =
          body.targetCommand !== undefined && body.targetCommand !== null ? String(body.targetCommand) : null;
        const paramsTemplate =
          body.paramsTemplate !== undefined ? asObject(body.paramsTemplate, "paramsTemplate") : undefined;
        if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
          throw new HttpError(400, "BAD_REQUEST", "enabled must be a boolean");
        }

        await assertTargetResolvable(ctx, body.targetType, targetId, targetCommand);

        const values: NewInputMapping = {
          name: String(body.name),
          protocol: body.protocol,
          pattern: String(body.pattern),
          targetType: body.targetType,
          targetId,
          targetCommand,
          ...(paramsTemplate !== undefined ? { paramsTemplate } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        };
        const created = await ctx.mappings.create(values);
        if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create mapping");

        await ctx.inputMapper.reload();
        return json(created, 201);
      }),
    },

    "/api/v1/mappings/test": {
      POST: route(async (req) => {
        const body = await readJson(req);
        requireFields(body, ["protocol", "address"]);
        assertProtocol(body.protocol);
        if (body.args !== undefined && !Array.isArray(body.args)) {
          throw new HttpError(400, "BAD_REQUEST", "args must be an array");
        }

        const matches = ctx.inputMapper.match({
          protocol: body.protocol,
          address: String(body.address),
          args: body.args as unknown[] | undefined,
        });
        const result: InputMappingTestResult = {
          matched: matches.length > 0,
          matches: matches.map((m) => ({
            id: m.mapping.id,
            name: m.mapping.name,
            targetType: m.mapping.targetType,
            targetId: m.mapping.targetId,
            targetCommand: m.mapping.targetCommand,
            pathParams: m.pathParams,
            params: m.params,
          })),
        };
        return json(result);
      }),
    },

    "/api/v1/mappings/:id": {
      GET: route(async (req) => {
        const mapping = await ctx.mappings.get(paramId(req));
        if (!mapping) throw new HttpError(404, "NOT_FOUND", "mapping not found");
        return json(mapping);
      }),

      PUT: route(async (req) => {
        const id = paramId(req);
        const body = await readJson(req);
        const current = await ctx.mappings.get(id);
        if (!current) throw new HttpError(404, "NOT_FOUND", "mapping not found");

        const patch: Partial<NewInputMapping> = {};
        if (body.name !== undefined) patch.name = String(body.name);
        if (body.protocol !== undefined) {
          assertProtocol(body.protocol);
          patch.protocol = body.protocol;
        }
        if (body.pattern !== undefined) patch.pattern = String(body.pattern);
        if (body.targetType !== undefined) {
          assertTargetType(body.targetType);
          patch.targetType = body.targetType;
        }
        if (body.targetId !== undefined) patch.targetId = body.targetId === null ? null : String(body.targetId);
        if (body.targetCommand !== undefined) {
          patch.targetCommand = body.targetCommand === null ? null : String(body.targetCommand);
        }
        if (body.paramsTemplate !== undefined) {
          patch.paramsTemplate = asObject(body.paramsTemplate, "paramsTemplate");
        }
        if (body.enabled !== undefined) {
          if (typeof body.enabled !== "boolean") {
            throw new HttpError(400, "BAD_REQUEST", "enabled must be a boolean");
          }
          patch.enabled = body.enabled;
        }

        // Validate the *effective* target (merge of patch over the current row).
        await assertTargetResolvable(
          ctx,
          patch.targetType ?? current.targetType,
          patch.targetId !== undefined ? patch.targetId : current.targetId,
          patch.targetCommand !== undefined ? patch.targetCommand : current.targetCommand,
        );

        const updated = await ctx.mappings.update(id, patch);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "mapping not found");

        await ctx.inputMapper.reload();
        return json(updated);
      }),

      DELETE: route(async (req) => {
        const removed = await ctx.mappings.remove(paramId(req));
        if (!removed) throw new HttpError(404, "NOT_FOUND", "mapping not found");
        await ctx.inputMapper.reload();
        return noContent();
      }),
    },

    "/api/v1/mappings/:id/toggle": {
      PATCH: route(async (req) => {
        const id = paramId(req);
        // Only a truly empty body means "flip"; malformed JSON is a 400.
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

        const current = await ctx.mappings.get(id);
        if (!current) throw new HttpError(404, "NOT_FOUND", "mapping not found");

        const enabled = typeof body.enabled === "boolean" ? body.enabled : !current.enabled;
        const updated = await ctx.mappings.setEnabled(id, enabled);
        if (!updated) throw new HttpError(404, "NOT_FOUND", "mapping not found");

        await ctx.inputMapper.reload();
        return json(updated);
      }),
    },
  };
}
