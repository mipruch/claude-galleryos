/**
 * NETIO driver manifest.
 *
 * One connection = one NETIO smart power strip (PowerBOX, PowerPDU, PowerDIN…).
 * The device exposes all outlets via a single HTTP endpoint (`/netio.json`).
 * Each socket outlet is modelled as a separate `netio.socket` endpoint.
 *
 * Protocol reference: NETIO M2M API Protocol JSON v2.4
 *   GET  http://<ip>/netio.json          → read all outputs + optional metering
 *   POST http://<ip>/netio.json  body:   → control one or more outputs
 *     { "Outputs": [{ "ID": N, "Action": 0-4 }] }
 *
 * Auth: HTTP Basic (username + password from connection config).
 * Default credentials shipped with every NETIO device: netio / netio.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "netio",
  name: "NETIO Smart Socket",
  version: "0.1.0",
  vendor: "NETIO products",
  description:
    "Controls NETIO networked power socket strips (PowerBOX, PowerPDU, PowerDIN…) " +
    "via the JSON M2M API over HTTP. Each physical outlet is one endpoint.",

  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "host" },
      port: {
        type: "integer",
        title: "Port",
        description: "HTTP port for the M2M API (may differ from the admin port on PowerPDU 4C).",
        default: 80,
        minimum: 1,
        maximum: 65535,
      },
      username: {
        type: "string",
        title: "Username",
        description: "HTTP Basic auth username (default: netio).",
        default: "netio",
      },
      password: {
        type: "string",
        title: "Password",
        description: "HTTP Basic auth password (default: netio).",
        default: "netio",
      },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        default: 3000,
        minimum: 500,
        maximum: 15000,
      },
    },
  },

  capabilities: {
    // No discovery — outputs are numbered 1..NumOutputs; user configures each.
    discovery: false,
    // HTTP poll only; no push channel.
    subscriptions: false,
    bidirectional: true,
  },

  endpointTypes: [
    {
      type: "netio.socket",
      name: "Power Socket",
      description: "One switched mains outlet on a NETIO device.",

      addressSchema: {
        type: "object",
        required: ["outputId"],
        properties: {
          outputId: {
            type: "integer",
            title: "Output ID",
            description: "Outlet number as shown in the NETIO web interface (1-based).",
            minimum: 1,
            maximum: 8,
          },
        },
        additionalProperties: false,
      },

      stateSchema: {
        type: "object",
        properties: {
          on: {
            type: "boolean",
            description: "Whether the outlet is powered on.",
          },
          load: {
            type: "number",
            description: "Instantaneous load in Watts (metered models only).",
          },
          current: {
            type: "number",
            description: "Instantaneous current in mA (metered models only).",
          },
          energy: {
            type: "number",
            description: "Cumulative energy counter in Wh (metered models only, resettable).",
          },
        },
      },

      commands: [
        {
          command: "on",
          description: "Switch the outlet ON.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "off",
          description: "Switch the outlet OFF.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "toggle",
          description: "Invert the outlet state (ON→OFF or OFF→ON).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "shortOn",
          description:
            "Switch the outlet ON for a short period, then switch it back OFF. " +
            "Useful for momentary triggers (e.g. door release, reboot button).",
          paramsSchema: {
            type: "object",
            properties: {
              delayMs: {
                type: "integer",
                title: "Duration (ms)",
                description:
                  "How long to stay ON before switching back. " +
                  "Omit to use the value configured in the NETIO device web interface.",
                minimum: 100,
              },
            },
          },
        },
        {
          command: "shortOff",
          description: "Switch the outlet OFF briefly, then switch it back ON (power-cycle).",
          paramsSchema: {
            type: "object",
            properties: {
              delayMs: {
                type: "integer",
                title: "Duration (ms)",
                description: "How long to stay OFF before switching back on.",
                minimum: 100,
              },
            },
          },
        },
      ],
    },
  ],
};
