/**
 * Static manifest for the Lunatone DALI-2 IoT driver.
 *
 * Target device: **Lunatone DALI-2 IoT** gateway (Art.Nr. 89453886). Unlike the
 * older serial/ASCII Lunatone gateways, this device exposes an HTTP REST + JSON
 * API on port 80 (`http://<ip>/info`, `/devices`, `/device/{id}/control`,
 * `/dali/scan`, …). There is no authentication. See the bundled manual at
 * `manuals/89453886_DALI2_IOT_API_Dokumentation_EN_M0023.pdf`.
 *
 * One connection == one DALI-2 IoT gateway (one DALI bus). Each registered
 * control gear on the bus becomes a `dali.fixture` endpoint.
 *
 * IMPORTANT addressing note: the gateway controls a fixture by its *identifying
 * number* (`id`, assigned during a device scan), NOT by its raw DALI short
 * address (0..63). The two differ. We therefore key endpoints on `deviceId`
 * (the IoT id) and keep the DALI short address as read-only metadata.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "dali-lunatone",
  name: "Lunatone DALI-2 IoT",
  version: "0.1.0",
  vendor: "Lunatone",
  description: "Controls DALI lighting via a Lunatone DALI-2 IoT gateway over its HTTP REST API.",

  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "host" },
      port: { type: "integer", title: "Port", default: 80, minimum: 1, maximum: 65535 },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        default: 4000,
        minimum: 500,
        maximum: 30000,
      },
      scanOnDiscover: {
        type: "boolean",
        title: "Run a bus scan on discovery",
        description:
          "When true, discoverEndpoints() triggers a DALI bus scan (~1 min) before listing devices. " +
          "When false (default), it lists already-registered devices only.",
        default: false,
      },
    },
  },

  capabilities: {
    // The gateway can scan the bus and enumerate fixtures.
    discovery: true,
    // No push channel in the REST API — the core polls via readState().
    subscriptions: false,
    bidirectional: true,
  },

  endpointTypes: [
    {
      type: "dali.fixture",
      name: "DALI Fixture",
      description: "A single DALI control gear (luminaire) registered on the gateway.",
      addressSchema: {
        type: "object",
        required: ["deviceId"],
        properties: {
          deviceId: {
            type: "integer",
            title: "Device ID",
            description: "Lunatone IoT identifying number (from a device scan). NOT the DALI short address.",
            minimum: 0,
          },
          daliAddress: {
            type: "integer",
            title: "DALI short address",
            description: "Raw DALI bus address (0..63), read-only metadata from discovery.",
            minimum: 0,
            maximum: 63,
          },
        },
        additionalProperties: false,
      },
      stateSchema: {
        type: "object",
        properties: {
          power: { type: "boolean", description: "Whether the fixture is on (switchable)." },
          brightness: { type: "number", minimum: 0, maximum: 1, description: "Dim level 0..1." },
        },
      },
      commands: [
        {
          command: "on",
          description: "Switch the fixture on (ControlData { switchable: true }).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "off",
          description: "Switch the fixture off (ControlData { switchable: false }).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "setBrightness",
          description: "Dim the fixture to a level 0..1 (ControlData { dimmable: 0..100 }).",
          paramsSchema: {
            type: "object",
            required: ["level"],
            properties: {
              level: { type: "number", title: "Level", minimum: 0, maximum: 1 },
            },
          },
        },
        {
          command: "recall",
          description: "Recall a stored DALI scene 0..15 (ControlData { scene }).",
          paramsSchema: {
            type: "object",
            required: ["scene"],
            properties: {
              scene: { type: "integer", title: "Scene", minimum: 0, maximum: 15 },
            },
          },
        },
      ],
    },
  ],
};
