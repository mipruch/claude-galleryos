/**
 * OSC 1.0 *encoder* for these tests — re-exported from `@gallery/driver-core`,
 * which owns the canonical encoder (drivers need it to send OSC; see
 * driver-generic-trigger). Kept as a local module so the OSC input tests don't
 * need to change their imports.
 */
export { encodeOscBundle, encodeOscMessage, oscString, type OscArg } from "@gallery/driver-core";
