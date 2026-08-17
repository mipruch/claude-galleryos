/**
 * Iiyama ProLite display driver manifest.
 *
 * One connection = one display, reached two different ways depending on
 * direction: powering **on** uses a UDP Wake-on-LAN magic packet (the display
 * accepts no TCP connections while off), while powering **off** and reading
 * power state use the binary RS232-over-LAN protocol over TCP 5000. There is
 * therefore no persistent socket to hold open — every action is a short-lived
 * transaction (see `IiyamaProliteDriver.ts`).
 *
 * Scope is deliberately narrow — the ask was "just turn it on and off" — so
 * only Power state Get/Set is implemented. Other RS232 commands (input
 * select, volume, video parameters, …) are documented in the manual
 * (`manuals/`) but left unimplemented.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "iiyama-prolite",
  name: "Iiyama ProLite Display",
  version: "0.1.0",
  vendor: "Iiyama",
  description:
    "Controls Iiyama ProLite commercial displays (e.g. ProLite T6529AS): Wake-on-LAN to power on, " +
    "the binary RS232-over-LAN protocol (TCP 5000) to power off and read back power state.",

  connectionSchema: {
    type: "object",
    required: ["host", "macAddress"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "host" },
      port: { type: "integer", title: "Port", default: 5000, minimum: 1, maximum: 65535 },
      macAddress: {
        type: "string",
        title: "MAC address",
        description:
          "The display's network MAC address, used to build the Wake-on-LAN magic packet that " +
          "powers it on. Requires the display's \"Power Save\" OSD setting to be Mode 2.",
        pattern: "^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$",
        examples: ["AA:BB:CC:DD:EE:FF"],
      },
      wolPort: {
        type: "integer",
        title: "Wake-on-LAN port",
        description: "UDP port the magic packet is sent to.",
        default: 9,
        minimum: 1,
        maximum: 65535,
      },
      broadcastAddress: {
        type: "string",
        title: "Wake-on-LAN broadcast address",
        description: "Destination address for the magic packet. Use the subnet broadcast address if the network filters 255.255.255.255.",
        default: "255.255.255.255",
      },
      monitorId: {
        type: "integer",
        title: "Monitor ID",
        description: "RS232/LAN protocol monitor address configured on-device. 1 unless daisy-chained.",
        default: 1,
        minimum: 1,
        maximum: 255,
      },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        description: "Max wait for the display's TCP response to a power-off / power-state command.",
        default: 3000,
        minimum: 200,
        maximum: 10000,
      },
    },
  },

  capabilities: {
    discovery: false,
    // The display never pushes state on its own — only replies to a Get Power query.
    subscriptions: false,
    bidirectional: true,
    // One connection == one display, so the connection-level healthCheck already covers it.
    endpointHealth: false,
  },

  endpointTypes: [
    {
      type: "iiyama-prolite.display",
      name: "Display",
      description: "A single Iiyama ProLite display, addressed by its connection's host + MAC.",
      // One display per connection — no extra addressing required.
      addressSchema: { type: "object", properties: {}, additionalProperties: false },
      stateSchema: {
        type: "object",
        properties: {
          power: { type: "string", enum: ["off", "on", "unknown"] },
        },
      },
      commands: [
        {
          command: "on",
          description: "Power the display on (sends a Wake-on-LAN magic packet).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "off",
          description: "Power the display off and wait for its confirmation over RS232-over-LAN.",
          paramsSchema: { type: "object", properties: {} },
        },
      ],

      widgets: [
        { kind: "power", trigger: "commands", onCommand: "on", offCommand: "off", stateKey: "power" },
      ],
    },
  ],
};
