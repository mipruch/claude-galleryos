/**
 * Static manifest for the PJLink driver.
 *
 * PJLink is a standardised TCP protocol (port 4352) for controlling projectors
 * from many vendors. One connection == one projector, so a connection has a
 * single endpoint of type `pjlink.projector`.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "pjlink",
  name: "PJLink Projector",
  version: "0.1.0",
  vendor: "PJLink (JBMIA)",
  description: "Controls PJLink Class 1 compatible projectors over TCP.",

  // Admin form for the connection. host/port map to ConnectionConfig.host/port;
  // the remaining fields land in ConnectionConfig.config.
  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "hostname" },
      port: { type: "integer", title: "Port", default: 4352, minimum: 1, maximum: 65535 },
      password: {
        type: "string",
        title: "Password",
        description: "Required only if the projector has PJLink authentication enabled.",
      },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        default: 2000,
        minimum: 200,
        maximum: 10000,
      },
    },
  },

  capabilities: {
    discovery: false,
    subscriptions: false, // poll-based; the core reads state via readState()
    bidirectional: true,
  },

  endpointTypes: [
    {
      type: "pjlink.projector",
      name: "Projector",
      description: "A single PJLink projector.",
      // One projector per connection — no extra addressing required.
      addressSchema: { type: "object", properties: {}, additionalProperties: false },
      stateSchema: {
        type: "object",
        properties: {
          power: { type: "string", enum: ["off", "on", "cooling", "warming", "unknown"] },
          input: { type: "string", description: "PJLink input code, e.g. 31 (HDMI1)" },
          muted: { type: "boolean", description: "AV mute state" },
        },
      },
      commands: [
        {
          command: "on",
          description: "Power the projector on (POWR 1).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "off",
          description: "Power the projector off (POWR 0).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "setInput",
          description: "Select an input. Accepts a friendly name (HDMI1, RGB1, …) or a raw 2-digit PJLink code.",
          paramsSchema: {
            type: "object",
            required: ["input"],
            properties: {
              input: { type: "string", title: "Input", examples: ["HDMI1", "RGB1", "31"] },
            },
          },
        },
        {
          command: "setMute",
          description: "Set AV mute on/off (AVMT 31/30).",
          paramsSchema: {
            type: "object",
            required: ["muted"],
            properties: { muted: { type: "boolean", title: "Muted" } },
          },
        },
      ],
    },
  ],
};
