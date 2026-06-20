/**
 * HTTP helpers for the native Bun.serve API.
 *
 * Provides a typed error model (mapped to README Appendix B codes), JSON
 * helpers, body parsing/validation, and a `route()` wrapper that turns thrown
 * errors into consistent JSON responses: `{ error, code, details? }`.
 */

import type { Server } from "bun";
import { errMsg } from "@gallery/driver-core";
import type { ApiError } from "@gallery/types";
import { logger } from "../logger.ts";

const httpLog = logger.child("api.http");

/** A request handler for Bun's native router. `req.params` holds path params. */
export type Handler = (req: Bun.BunRequest, server: Server<unknown>) => Response | Promise<Response>;

/** Per-method handlers for one route path. */
export type RouteMethods = Partial<Record<"GET" | "POST" | "PUT" | "DELETE" | "PATCH", Handler>>;

/** A set of route paths → method handlers. */
export type RouteMap = Record<string, RouteMethods>;

/** An error that carries an HTTP status + machine code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200): Response => Response.json(data, { status });

export const noContent = (): Response => new Response(null, { status: 204 });

/** Build a typed `ApiError` JSON response. */
const errorResponse = (body: ApiError, status: number): Response => Response.json(body, { status });

/** Convert any thrown value into a JSON error response. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return errorResponse({ error: err.message, code: err.code, details: err.details }, err.status);
  }
  const error = errMsg(err);
  // Map known DeviceManager errors to sensible status codes.
  if (error.includes("device not found")) return errorResponse({ error, code: "NOT_FOUND" }, 404);
  if (error.includes("no active driver")) return errorResponse({ error, code: "DRIVER_UNAVAILABLE" }, 503);
  return errorResponse({ error, code: "INTERNAL_ERROR" }, 500);
}

/** Wrap a handler so thrown errors become JSON error responses, and log the request. */
export function route(fn: Handler): Handler {
  return async (req, server) => {
    const start = Date.now();
    const method = req.method;
    const path = new URL(req.url).pathname;
    try {
      const res = await fn(req, server);
      httpLog.info("request", { method, path, status: res.status, ms: Date.now() - start });
      return res;
    } catch (err) {
      const res = toErrorResponse(err);
      httpLog.warn("request failed", {
        method,
        path,
        status: res.status,
        ms: Date.now() - start,
        error: errMsg(err),
      });
      return res;
    }
  };
}

/** Parse a JSON object body, or throw 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "BAD_REQUEST", "request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/** Throw 400 unless all listed fields are present and non-empty. */
export function requireFields(obj: Record<string, unknown>, fields: string[]): void {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === "");
  if (missing.length) {
    throw new HttpError(400, "BAD_REQUEST", `missing required field(s): ${missing.join(", ")}`, {
      missing,
    });
  }
}

/** Coerce a value to a plain object or throw 400. */
export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "BAD_REQUEST", `field '${field}' must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Read a query-string parameter. */
export function query(req: Request, key: string): string | undefined {
  return new URL(req.url).searchParams.get(key) ?? undefined;
}

/** Read the `:id` path parameter from a Bun route request. */
export const paramId = (req: Bun.BunRequest): string => (req.params as { id: string }).id;
