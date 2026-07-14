/**
 * Input-mapping routes — CRUD for the OSC/TCP/HTTP ingress rules plus a dry-run
 * matcher. A mapping is purely "when" (protocol + address pattern); what runs is
 * `trigger_actions` wired to it, so a mapping with none yet is still a valid row.
 *
 *   GET    /api/v1/mappings              list all rules (?protocol= ?enabled=)
 *   POST   /api/v1/mappings              create { name, protocol, pattern, enabled?, position? }
 *   GET    /api/v1/mappings/:id          one rule
 *   PUT    /api/v1/mappings/:id          update
 *   DELETE /api/v1/mappings/:id          delete
 *   PATCH  /api/v1/mappings/:id/toggle   enable/disable without delete
 *   POST   /api/v1/mappings/test         { protocol, address, args? } → matches (no dispatch)
 *
 * Every mutation writes the DB *and* reloads the live {@link InputMapper} cache so
 * changes take effect without a restart.
 */

import type { InputMappingTestResult, InputProtocol, NewInputMapping } from "@gallery/types";
import type { ApiContext } from "../context.ts";
import {
  HttpError,
  asCanvasPosition,
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

function assertProtocol(value: unknown): asserts value is InputProtocol {
  if (!PROTOCOLS.includes(value as InputProtocol)) {
    throw new HttpError(400, "BAD_REQUEST", `protocol must be one of: ${PROTOCOLS.join(", ")}`);
  }
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
        requireFields(body, ["name", "protocol", "pattern"]);
        assertProtocol(body.protocol);
        if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
          throw new HttpError(400, "BAD_REQUEST", "enabled must be a boolean");
        }

        const values: NewInputMapping = {
          name: String(body.name),
          protocol: body.protocol,
          pattern: String(body.pattern),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.position !== undefined ? { position: asCanvasPosition(body.position, "position") } : {}),
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
            pathParams: m.pathParams,
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
        if (body.enabled !== undefined) {
          if (typeof body.enabled !== "boolean") {
            throw new HttpError(400, "BAD_REQUEST", "enabled must be a boolean");
          }
          patch.enabled = body.enabled;
        }
        if (body.position !== undefined) patch.position = asCanvasPosition(body.position, "position");

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
