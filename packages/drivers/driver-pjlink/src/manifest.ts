/**
 * Static manifest for the PJLink driver.
 *
 * PJLink is a standardised TCP protocol (port 4352) for controlling projectors
 * from many vendors. One connection == one projector, so a connection has a
 * single endpoint of type `pjlink.projector`.
 *
 * `subscriptions: true` — the projector closes idle sockets after 30 s, so the
 * driver cannot hold a socket open; instead it polls on its own timer and emits
 * `state` events (a "fake push"). The core therefore subscribes the endpoint on
 * connect, which is how the driver learns the endpoint id to emit state for.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "pjlink",
  name: "PJLink Projector",
  version: "0.2.0",
  vendor: "PJLink (JBMIA)",
  description: "Controls PJLink Class 1 compatible projectors over TCP.",

  // Admin form for the connection. host/port map to ConnectionConfig.host/port;
  // the remaining fields land in ConnectionConfig.config.
  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "host" },
      port: { type: "integer", title: "Port", default: 4352, minimum: 1, maximum: 65535 },
      password: {
        type: "string",
        title: "Password",
        description: "Required only if the projector has PJLink authentication enabled.",
      },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        description: "Timeout for each network step (connect, banner, response).",
        default: 2000,
        minimum: 200,
        maximum: 10000,
      },
      pollIntervalMs: {
        type: "integer",
        title: "Status poll interval (ms)",
        description:
          "How often to connect and read the projector's status (POWR + INPT). " +
          "The projector disconnects idle sockets after ~30 s, so each poll uses a fresh connection.",
        default: 30000,
        minimum: 5000,
        maximum: 600000,
      },
      erstIntervalMs: {
        type: "integer",
        title: "Error status poll interval (ms)",
        description:
          "How often to request ERST (fan/lamp/temp/cover/filter/other error status). " +
          "Infrequent by design — error states rarely change.",
        default: 60000,
        minimum: 10000,
        maximum: 3600000,
      },
    },
  },

  capabilities: {
    discovery: false,
    // Poll-emulated push: the driver runs its own status poll and emits `state`.
    // `subscriptions: true` is also how the core hands the driver its endpoint id
    // (via subscribeToEndpoint) so the poll loop can tag emitted state — it does
    // NOT cause any extra network I/O.
    subscriptions: true,
    bidirectional: true,
    // No per-endpoint probe: one connection == one projector, so the cached
    // connection-level healthCheck already reflects the projector's reachability.
    // Leaving endpointHealth false makes the watchdog skip layer-2 entirely.
    endpointHealth: false,
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
          input: { type: "string", description: "PJLink input code, e.g. 31 (Digital)" },
          inputLabel: { type: "string", description: "Friendly input label, e.g. 'Digital (31)'" },
          muted: {
            type: "boolean",
            description: "AV mute state (true = muted). Set via setMute; not polled.",
          },
          errors: {
            type: "object",
            description: "Per-subsystem error status from ERST (ok / warning / error).",
            properties: {
              fan: { type: "string" },
              lamp: { type: "string" },
              temperature: { type: "string" },
              cover: { type: "string" },
              filter: { type: "string" },
              other: { type: "string" },
            },
          },
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
