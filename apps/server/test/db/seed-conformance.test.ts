/**
 * Seed-conformance — every row the seed inserts must satisfy its driver manifest.
 *
 * Hermetic (no DB): imports the exported `SEED_*` data and runs each connection
 * config, device address, and device-targeting scene-action param through the
 * same Ajv validators the routes/DeviceManager use. This locks the seed to the
 * manifests, so the level-scale / param-name drift this round fixed can't return.
 */

import { describe, expect, test } from "bun:test";
import { SEED_CONNECTIONS, SEED_DEVICES, SEED_SCENE_ACTIONS } from "../../src/db/seed.ts";
import {
  assertValidCommandParams,
  assertValidConnectionConfig,
  assertValidDeviceAddress,
} from "../../src/api/validation.ts";

const connById = new Map(SEED_CONNECTIONS.map((c) => [c.id, c]));
const devById = new Map(SEED_DEVICES.map((d) => [d.id, d]));

/** Endpoint type a device is addressed as (subtype, falling back to type). */
const endpointTypeOf = (d: { subtype?: string; type: string }): string => d.subtype ?? d.type;

describe("seed data conforms to driver manifests", () => {
  test("every connection config is valid", () => {
    for (const c of SEED_CONNECTIONS) {
      expect(() =>
        assertValidConnectionConfig(c.driverId, {
          host: c.host ?? undefined,
          port: c.port ?? undefined,
          ...(c.config as Record<string, unknown>),
        }),
      ).not.toThrow();
    }
  });

  test("every device address is valid", () => {
    for (const d of SEED_DEVICES) {
      const conn = connById.get(d.connectionId);
      expect(conn, `device ${d.name} references a seeded connection`).toBeDefined();
      expect(() =>
        assertValidDeviceAddress(conn!.driverId, endpointTypeOf(d), d.address as Record<string, unknown>),
      ).not.toThrow();
    }
  });

  test("every device-targeting scene action's params are valid", () => {
    for (const a of SEED_SCENE_ACTIONS) {
      if (!a.deviceId || !a.command) continue; // sub-scene action (no device/command)
      const dev = devById.get(a.deviceId);
      expect(dev, `action ${a.id} references a seeded device`).toBeDefined();
      const conn = connById.get(dev!.connectionId);
      expect(conn).toBeDefined();
      expect(() =>
        assertValidCommandParams(
          conn!.driverId,
          endpointTypeOf(dev!),
          a.command,
          (a.params ?? {}) as Record<string, unknown>,
        ),
      ).not.toThrow();
    }
  });
});
