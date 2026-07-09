/**
 * Public surface of the driver SDK. Drivers import everything from
 * `@gallery/driver-core`.
 */
export type { IDeviceDriver } from "./IDeviceDriver.ts";
export * from "./types.ts";
export * from "./ipc.ts";
export { TcpClient, type TcpClientOptions } from "./transport.ts";
export { errMsg } from "./util.ts";
export { encodeOscBundle, encodeOscMessage, oscString, parseOscArgs, type OscArg } from "./osc.ts";
