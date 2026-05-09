import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import type { DriverManifest } from '@galleryos/driver-core';

import { manifest as tcpGenericManifest } from '@galleryos/driver-tcp-generic';
import { manifest as pjlinkManifest } from '@galleryos/driver-pjlink';
import { manifest as bssManifest } from '@galleryos/driver-bss-soundweb';

export interface DriverRegistration {
  manifest: DriverManifest;
  /** Module specifier passed to the subprocess to dynamically import the driver. */
  modulePath: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export const DRIVERS: DriverRegistration[] = [
  {
    manifest: tcpGenericManifest,
    modulePath: '@galleryos/driver-tcp-generic',
  },
  {
    manifest: pjlinkManifest,
    modulePath: '@galleryos/driver-pjlink',
  },
  {
    manifest: bssManifest,
    modulePath: '@galleryos/driver-bss-soundweb',
  },
];

export function getDriver(driverId: string): DriverRegistration | undefined {
  return DRIVERS.find((d) => d.manifest.id === driverId);
}

export function listManifests(): DriverManifest[] {
  return DRIVERS.map((d) => d.manifest);
}

function resolveEntrypoint(): string {
  const jsPath = path.join(here, '..', 'drivers', 'driverEntrypoint.js');
  if (fs.existsSync(jsPath)) return jsPath;
  const tsPath = path.join(here, '..', 'drivers', 'driverEntrypoint.ts');
  return tsPath;
}

export const DRIVER_ENTRYPOINT_PATH = resolveEntrypoint();
