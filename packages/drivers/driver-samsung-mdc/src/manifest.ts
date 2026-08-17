/**
 * Samsung MDC display driver manifest.
 *
 * One connection = one TCP link (port 1515) to the display's built-in MDC/LAN
 * port, or to an RS232-over-Ethernet gateway bridging a daisy-chain of sets.
 * Either way, many displays can share one connection — each is addressed by
 * its own MDC display ID (set on-device: menu → Multi Display Control → ID).
 *
 * Only Power Control (protocol command 0x11) is implemented: `on` / `off` and
 * a power-only `readState`. Other MDC commands (input select, volume, video
 * wall, …) are left for a future iteration — see PLAN.md §1.5.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "samsung-mdc",
  name: "Samsung MDC Display",
  version: "0.1.0",
  vendor: "Samsung",
  description:
    "Controls Samsung commercial displays over the binary MDC protocol (TCP 1515). " +
    "Currently supports power on/off only.",

  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "host" },
      port: { type: "integer", title: "Port", default: 1515, minimum: 1, maximum: 65535 },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        description: "Max wait for a display's ACK/NAK to a command.",
        default: 2000,
        minimum: 200,
        maximum: 10000,
      },
      reconnectMs: {
        type: "integer",
        title: "Reconnect delay (ms)",
        description: "Base delay before reconnecting after a dropped socket.",
        default: 2000,
        minimum: 250,
        maximum: 60000,
      },
    },
  },

  capabilities: {
    // Display IDs are configured on-device; nothing to auto-discover.
    discovery: false,
    // MDC displays don't push unsolicited state changes.
    subscriptions: false,
    // Power can be read back via a status query.
    bidirectional: true,
    // Many displays can share one connection, so each is probed independently.
    endpointHealth: true,
  },

  // A set on its own LAN port is the common wiring: one connection, one
  // display. The admin UI collapses that pair into a single row (the
  // daisy-chain case still works — add more endpoints to the connection).
  soloEndpointType: "samsung-mdc.display",

  endpointTypes: [
    {
      type: "samsung-mdc.display",
      name: "Display",
      description: "One Samsung display, addressed by its MDC display ID.",

      addressSchema: {
        type: "object",
        required: ["displayId"],
        properties: {
          displayId: {
            type: "integer",
            title: "Display ID",
            description: "MDC display ID configured on the set (menu: Multi Display Control → ID).",
            // What a set on its own IP is left at; only daisy-chains renumber.
            default: 1,
            minimum: 1,
            maximum: 255,
          },
        },
        additionalProperties: false,
      },

      stateSchema: {
        type: "object",
        properties: {
          power: { type: "string", enum: ["off", "on", "unknown"] },
        },
      },

      commands: [
        {
          command: "on",
          description: "Power the display on.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "off",
          description: "Power the display off.",
          paramsSchema: { type: "object", properties: {} },
        },
      ],

      widgets: [
        { kind: "power", trigger: "commands", onCommand: "on", offCommand: "off", stateKey: "power" },
      ],
    },
  ],
};
