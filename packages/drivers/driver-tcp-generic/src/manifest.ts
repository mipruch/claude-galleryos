/**
 * Static manifest for the generic TCP driver.
 *
 * A deliberately minimal, protocol-agnostic driver: it sends a configurable
 * text payload over TCP and optionally reads one delimited response. Useful for
 * simple devices (relays, curtain controllers, custom boxes) where defining a
 * full driver would be overkill. Scenes/commands carry the raw payload.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "tcp-generic",
  name: "Generic TCP Device",
  version: "0.1.0",
  vendor: "GalleryOS",
  description: "Sends configurable TCP payloads to simple devices.",

  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "hostname" },
      port: { type: "integer", title: "Port", minimum: 1, maximum: 65535 },
      txDelimiter: {
        type: "string",
        title: "TX delimiter",
        description: "Appended to outgoing payloads (use \\r, \\n, \\r\\n).",
        default: "\r\n",
      },
      rxDelimiter: {
        type: "string",
        title: "RX delimiter",
        description: "Frames incoming responses.",
        default: "\r\n",
      },
      encoding: { type: "string", title: "Encoding", default: "utf-8", enum: ["utf-8", "latin1", "ascii"] },
      responseTimeoutMs: { type: "integer", title: "Response timeout (ms)", default: 2000, minimum: 100, maximum: 30000 },
      persistent: {
        type: "boolean",
        title: "Keep connection open",
        description: "Maintain one socket instead of connecting per command.",
        default: false,
      },
    },
  },

  capabilities: { discovery: false, subscriptions: false, bidirectional: true },

  endpointTypes: [
    {
      type: "tcp-generic.endpoint",
      name: "Generic endpoint",
      description: "A device addressed by raw TCP payloads.",
      // Free-form address — purely informational for this driver.
      addressSchema: { type: "object", properties: { label: { type: "string", title: "Label" } } },
      stateSchema: {
        type: "object",
        properties: { lastResponse: { type: "string" } },
      },
      commands: [
        {
          command: "send",
          description: "Send a payload, optionally waiting for one response frame.",
          paramsSchema: {
            type: "object",
            required: ["payload"],
            properties: {
              payload: { type: "string", title: "Payload" },
              expectResponse: { type: "boolean", title: "Wait for response", default: false },
              appendDelimiter: { type: "boolean", title: "Append TX delimiter", default: true },
            },
          },
        },
      ],
    },
  ],
};
