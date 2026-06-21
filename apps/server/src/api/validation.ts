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

/**
 * Retrieves or compiles a cached validator for the given schema.
 *
 * @param key - The cache key for this schema
 * @param schema - The JSON Schema to validate against
 * @returns The compiled validator function
 */
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

/**
 * Validates data against a JSON schema, throwing an HttpError on validation failure.
 * 
 * @param key - Cache key for the compiled validator
 * @param what - Error message prefix used when validation fails
 * @throws HttpError with status 400 and code "VALIDATION" if validation fails, with summarized errors in the message and full error details attached
 */
function assertValid(key: string, schema: JsonSchema, data: unknown, what: string): void {
  const validate = compiled(key, schema);
  if (!validate(data)) {
    throw new HttpError(400, "VALIDATION", `${what}: ${summarize(validate.errors)}`, validate.errors);
  }
}

/**
 * Retrieves a driver manifest from the registry.
 *
 * @param driverId - The identifier of the driver to look up
 * @returns The driver manifest
 * @throws HttpError with code 400 if the driver is not found
 */
function manifestOf(driverId: string): DriverManifest {
  const manifest = driverRegistry.get(driverId);
  if (!manifest) throw new HttpError(400, "BAD_REQUEST", `unknown driver: ${driverId}`);
  return manifest;
}

/**
 * Retrieves an endpoint type definition from a driver manifest.
 *
 * @param manifest - The driver manifest to search
 * @param endpointType - The endpoint type name to look up
 * @returns The endpoint type definition matching the requested type
 * @throws HttpError with status 400 and code "BAD_REQUEST" if the endpoint type is not found
 */
function endpointOf(manifest: DriverManifest, endpointType: string): EndpointTypeDefinition {
  const endpoint = manifest.endpointTypes.find((e) => e.type === endpointType);
  if (!endpoint) {
    throw new HttpError(400, "BAD_REQUEST", `unknown endpoint type '${endpointType}' for driver '${manifest.id}'`);
  }
  return endpoint;
}

/**
 * Validates a connection configuration against the driver's schema.
 *
 * @throws Throws an error if the connection configuration does not match the schema.
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
 * Validates a command's parameters against its schema and ensures the command is defined in the endpoint type.
 *
 * Throws an HTTP 400 error if the command is unknown or if the parameters fail validation.
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
