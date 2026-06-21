/**
 * Manifest-schema validation (Ajv).
 *
 * Every driver manifest ships JSON Schemas for its connection config, each
 * endpoint's address, and each command's params. Until now those schemas were
 * documentation only — nothing enforced them, so malformed input reached the
 * drivers (or the seed drifted out of spec). This module compiles them with Ajv
 * and exposes three `assert*` guards that throw a 400 `HttpError` (code
 * `VALIDATION`, with the Ajv error list as `details`) when input doesn't match.
 *
 * Wiring:
 *   - connection config  → connections route POST/PUT
 *   - device address     → devices route POST/PUT
 *   - command params     → DeviceManager.execute() (one choke point covering
 *                          REST, WebSocket, and scene execution)
 *
 * Compiled validators are cached per (driver, schema) so repeated calls are cheap.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { DriverManifest, EndpointTypeDefinition, JsonSchema } from "@gallery/driver-core";
import { driverRegistry } from "../core/DriverRegistry.ts";
import { HttpError } from "./http.ts";

// `strict: false` keeps Ajv tolerant of the annotation keywords our manifests
// carry (`title`, `examples`, …) and of formats it doesn't know; `addFormats`
// supplies the ones we use (notably `hostname`). `allErrors` collects every
// problem so the response lists them all, not just the first.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators = new Map<string, ValidateFunction>();

function compiled(key: string, schema: JsonSchema): ValidateFunction {
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema as Record<string, unknown>);
    validators.set(key, validate);
  }
  return validate;
}

/** Turn Ajv's error list into a concise, human-readable summary. */
function summarize(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "invalid input";
  return errors
    .map((e) => {
      const where = e.instancePath ? e.instancePath.replace(/^\//, "").replace(/\//g, ".") : "(root)";
      return `${where} ${e.message ?? "is invalid"}`.trim();
    })
    .join("; ");
}

/** Validate `data` against `schema`; throw 400 VALIDATION on failure. */
function assertValid(key: string, schema: JsonSchema, data: unknown, what: string): void {
  const validate = compiled(key, schema);
  if (!validate(data)) {
    throw new HttpError(400, "VALIDATION", `${what}: ${summarize(validate.errors)}`, validate.errors);
  }
}

function manifestOf(driverId: string): DriverManifest {
  const manifest = driverRegistry.get(driverId);
  if (!manifest) throw new HttpError(400, "BAD_REQUEST", `unknown driver: ${driverId}`);
  return manifest;
}

function endpointOf(manifest: DriverManifest, endpointType: string): EndpointTypeDefinition {
  const endpoint = manifest.endpointTypes.find((e) => e.type === endpointType);
  if (!endpoint) {
    throw new HttpError(400, "BAD_REQUEST", `unknown endpoint type '${endpointType}' for driver '${manifest.id}'`);
  }
  return endpoint;
}

/**
 * Validate a connection's settings against the driver's `connectionSchema`.
 * `form` is the form-level shape `{ host, port, ...config }` — host/port are
 * stored as columns but the schema describes the whole admin form.
 */
export function assertValidConnectionConfig(driverId: string, form: Record<string, unknown>): void {
  const manifest = manifestOf(driverId);
  assertValid(`conn:${driverId}`, manifest.connectionSchema, form, "invalid connection config");
}

/** Validate a device's `address` against its endpoint type's `addressSchema`. */
export function assertValidDeviceAddress(driverId: string, endpointType: string, address: unknown): void {
  const endpoint = endpointOf(manifestOf(driverId), endpointType);
  assertValid(`addr:${driverId}:${endpointType}`, endpoint.addressSchema, address, "invalid device address");
}

/**
 * Validate a command's `params` against its `paramsSchema`. Also rejects
 * commands the endpoint type doesn't declare (the manifest is the contract).
 */
export function assertValidCommandParams(
  driverId: string,
  endpointType: string,
  command: string,
  params: Record<string, unknown>,
): void {
  const endpoint = endpointOf(manifestOf(driverId), endpointType);
  const def = endpoint.commands.find((c) => c.command === command);
  if (!def) {
    throw new HttpError(400, "BAD_REQUEST", `unknown command '${command}' for endpoint '${endpointType}'`);
  }
  assertValid(`cmd:${driverId}:${endpointType}:${command}`, def.paramsSchema, params, `invalid params for '${command}'`);
}
