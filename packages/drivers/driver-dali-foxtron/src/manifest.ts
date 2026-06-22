/**
 * Foxtron DALI driver manifest.
 *
 * One connection = one Foxtron DALInet or DALI2net gateway (TCP). The DALI bus
 * is shared by all fixture endpoints on that connection. Each fixture is one
 * `dali-foxtron.fixture` endpoint, addressed by its DALI short address (0–63).
 *
 * The DALI2net model has two independent DALI buses — use port 23 for bus 1 and
 * port 24 for bus 2, with two separate connections in GalleryOS.
 *
 * Protocol: ASCII-framed binary over TCP.
 * Default gateway IP: 192.168.1.241 (configurable in the Foxtron web admin).
 *
 * TRANSPORT NOTE: the gateway drops idle TCP connections after ~1–2 s, so the
 * driver opens a SHORT-LIVED connection per command (connect → send → close)
 * rather than holding a persistent socket. There is no reconnect loop.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "dali-foxtron",
  name: "Foxtron DALI Gateway",
  version: "0.1.0",
  vendor: "Foxtron",
  description:
    "Controls DALI luminaires via a Foxtron DALInet or DALI2net gateway over its " +
    "ASCII TCP protocol. Each DALI short address (0–63) is one endpoint.",

  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: {
        type: "string",
        title: "Host / IP",
        description: "Foxtron gateway IP address (default: 192.168.1.241).",
        format: "host",
      },
      port: {
        type: "integer",
        title: "Port",
        description: "TCP port: 23 = DALI bus 1, 24 = DALI bus 2 (DALI2net only).",
        default: 23,
        minimum: 1,
        maximum: 65535,
      },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        description: "Max wait for the TCP connect and any DALI query reply (Type 13/14).",
        default: 1000,
        minimum: 200,
        maximum: 5000,
      },
    },
  },

  capabilities: {
    // No auto-discovery in this driver (DALI scan can be done via the gateway web UI).
    discovery: false,
    // DALI is unicast request/response — no push subscriptions.
    subscriptions: false,
    bidirectional: true,
  },

  endpointTypes: [
    {
      type: "dali-foxtron.fixture",
      name: "DALI Fixture / Group",
      description:
        "A DALI target on the bus: a single control gear (short address 0–63), " +
        "a group (0–15), or broadcast (all devices).",

      addressSchema: {
        type: "object",
        properties: {
          addressMode: {
            type: "string",
            title: "Addressing mode",
            description:
              "How to target the bus. 'address' = one fixture, 'group' = a DALI " +
              "group, 'broadcast' = all fixtures. Defaults to 'address' when omitted.",
            enum: ["address", "group", "broadcast"],
            default: "address",
          },
          daliAddress: {
            type: "integer",
            title: "DALI short address",
            description: "Individual control gear address (0–63). Used when mode = 'address'.",
            minimum: 0,
            maximum: 63,
          },
          group: {
            type: "integer",
            title: "DALI group",
            description: "Group number (0–15). Used when mode = 'group'.",
            minimum: 0,
            maximum: 15,
          },
        },
        additionalProperties: false,
      },

      stateSchema: {
        type: "object",
        properties: {
          on: {
            type: "boolean",
            description: "Whether the fixture is switched on.",
          },
          brightness: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Current dim level: 0 = off/min, 1 = max (DAPC 254).",
          },
        },
      },

      commands: [
        {
          command: "on",
          description: "Switch the fixture on at maximum brightness (Recall Max Level).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "off",
          description: "Switch the fixture off (DALI Off command, no fade).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "setBrightness",
          description: "Set brightness level 0..1 via DALI DAPC (Direct Arc Power Control). 0 = off.",
          paramsSchema: {
            type: "object",
            required: ["level"],
            properties: {
              level: { type: "number", title: "Level (0..1)", minimum: 0, maximum: 1 },
            },
          },
        },
        {
          command: "recall",
          description: "Recall a stored DALI scene (0–15).",
          paramsSchema: {
            type: "object",
            required: ["scene"],
            properties: {
              scene: { type: "integer", title: "Scene number (0–15)", minimum: 0, maximum: 15 },
            },
          },
        },
      ],
    },
  ],
};
