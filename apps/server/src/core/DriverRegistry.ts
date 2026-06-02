/**
 * DriverRegistry — read-only access to installed driver manifests.
 *
 * Reads every installed driver's manifest without instantiating it, so the
 * admin UI can render dynamic forms (`GET /api/v1/drivers`). The actual driver
 * classes are only instantiated inside subprocesses by the runtime harness.
 */

import type { DriverManifest } from "@gallery/driver-core";
import { DRIVERS } from "../drivers/registry.ts";

export class DriverRegistry {
  private readonly byId = new Map<string, DriverManifest>(
    DRIVERS.map((d) => [d.manifest.id, d.manifest]),
  );

  /** All installed driver manifests. */
  list(): DriverManifest[] {
    return [...this.byId.values()];
  }

  /** One manifest by driver id. */
  get(driverId: string): DriverManifest | undefined {
    return this.byId.get(driverId);
  }

  has(driverId: string): boolean {
    return this.byId.has(driverId);
  }
}

export const driverRegistry = new DriverRegistry();
