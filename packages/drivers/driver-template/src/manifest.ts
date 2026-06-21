/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DRIVER TEMPLATE — manifest.ts                                            │
 * │                                                                           │
 * │  The manifest is the *static* description of your driver. The core can    │
 * │  read it WITHOUT instantiating the driver, so the admin UI renders        │
 * │  connection/command forms straight from the JSON Schemas below.           │
 * │                                                                           │
 * │  HOW TO USE THIS TEMPLATE                                                  │
 * │    1. Copy the whole `driver-template/` folder to `driver-<your-id>/`.     │
 * │    2. Rename the package in package.json (`@gallery/driver-<your-id>`).    │
 * │    3. Fill in every `TODO` below.                                          │
 * │    4. Implement the matching logic in `TemplateDriver.ts`.                 │
 * │    5. Register the driver in `apps/server/src/drivers/registry.ts`         │
 * │       and add it to `apps/server/package.json` dependencies.               │
 * │                                                                           │
 * │  Schemas are a dependency-free subset of JSON Schema draft-7 (see          │
 * │  `JsonSchema` in @gallery/driver-core). Anything the admin form should     │
 * │  collect must appear here.                                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  // TODO: kebab-case, unique across all drivers, no vendor prefix (e.g. "pjlink").
  //       This is the value stored in `connections.driver` and looked up in the registry.
  id: "template",
  // TODO: human-friendly name shown in the admin UI.
  name: "Template Driver",
  // TODO: bump on every protocol/behaviour change.
  version: "0.1.0",
  // TODO: the manufacturer / standards body this driver targets.
  vendor: "GalleryOS",
  description: "Skeleton driver. Copy it to bootstrap a new device integration.",

  // ── Connection schema ──────────────────────────────────────────────────
  // Describes the gateway-level settings for ONE physical connection.
  //   - `host` and `port` are lifted onto ConnectionConfig.host/port by the core.
  //   - Everything else lands in ConnectionConfig.config and is yours to read.
  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "hostname" },
      // TODO: set the real default port for your protocol.
      port: { type: "integer", title: "Port", default: 1234, minimum: 1, maximum: 65535 },
      // TODO: add any driver-specific connection options (password, model, etc.).
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        default: 2000,
        minimum: 200,
        maximum: 10000,
      },
    },
  },

  // ── Capabilities ───────────────────────────────────────────────────────
  // These flip optional behaviour in the core. Only set `true` for what you
  // actually implement, or the watchdog/UI will call methods you don't have.
  capabilities: {
    // discovery:      implement `discoverEndpoints()` if true.
    discovery: false,
    // subscriptions:  implement `subscribeToEndpoint()` + emit "state" events if true.
    //                 false → the core polls via `readState()` instead.
    subscriptions: false,
    // bidirectional:  can current state be read back from the device?
    bidirectional: true,
  },

  // ── Endpoint types ─────────────────────────────────────────────────────
  // One driver can expose several addressable endpoint kinds (a matrix has
  // outputs, a DSP has faders, …). Each `Device` row picks a `type` from here.
  endpointTypes: [
    {
      // TODO: format as `<driver-id>.<thing>` (e.g. "extron-matrix.output").
      type: "template.device",
      name: "Template Device",
      description: "A single addressable thing behind the connection.",

      // addressSchema → validates `Device.address`. Use {} for single-endpoint
      // devices (one endpoint per connection). For multi-drop buses, capture the
      // sub-address here (channel, displayId, output number, …).
      addressSchema: {
        type: "object",
        properties: {
          // TODO: e.g. channel: { type: "integer", minimum: 1, maximum: 8 }
        },
        additionalProperties: false,
      },

      // stateSchema → describes the object you emit in "state" events and return
      // from `readState()`. Keep keys stable; the UI binds to them.
      stateSchema: {
        type: "object",
        properties: {
          power: { type: "boolean", description: "Whether the device is on." },
          level: { type: "number", minimum: 0, maximum: 1, description: "0..1 level." },
        },
      },

      // commands → the verbs the API/scene engine can invoke. The `command`
      // string is what arrives in `executeCommand(endpoint, command, params)`.
      commands: [
        {
          command: "on",
          description: "Power the device on.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "off",
          description: "Power the device off.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "setLevel",
          description: "Set the level (0..1).",
          paramsSchema: {
            type: "object",
            required: ["level"],
            properties: {
              level: { type: "number", title: "Level", minimum: 0, maximum: 1 },
            },
          },
        },
        // TODO: add the rest of your commands here.
      ],
    },
  ],
};
