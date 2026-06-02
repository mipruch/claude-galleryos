// Every driver package exports its static `manifest` plus a default class that
// implements IDeviceDriver. The registry imports exactly these two symbols.
export { manifest } from "./manifest.ts";
export { TemplateDriver as default } from "./TemplateDriver.ts";
