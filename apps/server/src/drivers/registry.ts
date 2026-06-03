/**
 * The list of installed drivers.
 *
 * This is the single place to register a new driver (see README §14, step 5).
 * Both the parent (DriverRegistry, for serving manifests to the UI/API) and the
 * subprocess runtime (to instantiate the right driver class) import from here.
 *
 * Each driver exports its `manifest` and a default class implementing
 * `IDeviceDriver`.
 */

import type { DriverManifest, IDeviceDriver } from "@gallery/driver-core";
import BssSoundwebDriver, { manifest as bssSoundwebManifest } from "@gallery/driver-bss";
import DaliFoxtronDriver, { manifest as daliFoxtronManifest } from "@gallery/driver-dali-foxtron";
import DaliLunatoneDriver, { manifest as daliLunatoneManifest } from "@gallery/driver-dali-lunatone";
import NetioDriver, { manifest as netioManifest } from "@gallery/driver-netio";
import PjlinkDriver, { manifest as pjlinkManifest } from "@gallery/driver-pjlink";
import TcpGenericDriver, { manifest as tcpGenericManifest } from "@gallery/driver-tcp-generic";

/** A driver's static manifest paired with its instantiable class. */
export interface DriverRegistration {
  manifest: DriverManifest;
  DriverClass: new () => IDeviceDriver;
}

export const DRIVERS: readonly DriverRegistration[] = [
  { manifest: pjlinkManifest, DriverClass: PjlinkDriver },
  { manifest: tcpGenericManifest, DriverClass: TcpGenericDriver },
  { manifest: daliLunatoneManifest, DriverClass: DaliLunatoneDriver },
  { manifest: bssSoundwebManifest, DriverClass: BssSoundwebDriver },
  { manifest: netioManifest, DriverClass: NetioDriver },
  { manifest: daliFoxtronManifest, DriverClass: DaliFoxtronDriver },
];

/** Look up a driver registration by its manifest id. */
export function getDriverRegistration(driverId: string): DriverRegistration | undefined {
  return DRIVERS.find((d) => d.manifest.id === driverId);
}
