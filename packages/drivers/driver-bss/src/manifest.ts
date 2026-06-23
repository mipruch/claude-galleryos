/**
 * BSS Soundweb London driver manifest.
 *
 * One connection = one TCP socket to a Soundweb processor (port 1023). Many
 * fader endpoints share that socket; each endpoint addresses one Gain object's
 * level + mute parameters. Fader endpoint is compatible with matrix Gain/Mute block also.
 *
 * Addressing follows the London DI hierarchy (see london-di.ts):
 *   node (device) → virtualDevice (Audio=3) → object (the Gain block) →
 *   parameter ids for gain and mute.
 *
 * The PLAN.md sketched `address: { node, virtualDevice, object, parameter }`
 * (a single parameter). A real fader needs *two* parameters — gain and mute —
 * so the address carries `gainParam` and `muteParam` instead. Param ids come
 * from Audio Architect's Venue Explorer for the specific object.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "bss-soundweb",
  name: "BSS Soundweb London",
  version: "0.1.0",
  vendor: "BSS Audio (Harman)",
  description:
    "BSS Soundweb London (BLU-series) DSP over the London DI protocol (TCP 1023). " +
    "Per-fader level + mute with live subscriptions.",

  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "host" },
      port: { type: "integer", title: "Port", default: 1023, minimum: 1, maximum: 65535 },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        description: "Max wait for a SUBSCRIBE reply when reading state.",
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
    // No auto-discovery: addresses are configured from Audio Architect.
    discovery: false,
    // The device pushes value changes after SUBSCRIBE.
    subscriptions: true,
    // Current values can be read back (via SUBSCRIBE).
    bidirectional: true,
  },

  endpointTypes: [
    {
      type: "bss-soundweb.fader",
      name: "Fader (Gain object)",
      description: "A single Gain processing object: level (0..1) + mute.",

      addressSchema: {
        type: "object",
        required: ["node", "object"],
        properties: {
          node: {
            type: "integer",
            title: "Node address",
            description: "Physical device id (Venue Explorer).",
            minimum: 1,
            maximum: 65534,
          },
          virtualDevice: {
            type: "integer",
            title: "Virtual device",
            description: "Object category — Audio = 3, Logic = 2.",
            default: 3,
            minimum: 0,
            maximum: 255,
          },
          object: {
            type: "integer",
            title: "Object id",
            description: "24-bit Processing Object id (the Gain block).",
            minimum: 0,
            maximum: 16777215,
          },
          gainParam: {
            type: "integer",
            title: "Gain parameter id",
            description: "Parameter id for the gain/level value.",
            default: 0,
            minimum: 0,
            maximum: 65535,
          },
          muteParam: {
            type: "integer",
            title: "Mute parameter id",
            description: "Parameter id for the mute switch.",
            default: 1,
            minimum: 0,
            maximum: 65535,
          },
        },
        additionalProperties: false,
      },

      stateSchema: {
        type: "object",
        properties: {
          level: { type: "number", minimum: 0, maximum: 1, description: "Fader level 0..1." },
          muted: { type: "boolean", description: "Whether the channel is muted." },
        },
      },

      commands: [
        {
          command: "setLevel",
          description: "Set the fader level (0..1) via SET PERCENT.",
          paramsSchema: {
            type: "object",
            required: ["level"],
            properties: { level: { type: "number", title: "Level", minimum: 0, maximum: 1 } },
          },
        },
        {
          command: "setMute",
          description: "Mute or unmute the channel.",
          paramsSchema: {
            type: "object",
            required: ["muted"],
            properties: { muted: { type: "boolean", title: "Muted" } },
          },
        },
      ],
    },

    {
      type: "bss-soundweb.meter-widget",
      name: "Meter widget (live bars)",
      description:
        "A panel of live signal meters. The widget streams each meter only while it is " +
        "visible on screen; the server keeps one BSS subscription per meter and fans the " +
        "readings out to every watching browser.",

      // A meter widget is a *virtual* device: one node, many meter objects. Each
      // meter is a single read-only parameter (its level); the admin gives it a
      // label and the meter object's id (from Audio Architect's Venue Explorer).
      addressSchema: {
        type: "object",
        required: ["node", "meters"],
        properties: {
          node: {
            type: "integer",
            title: "Node address",
            description: "Physical device id (Venue Explorer).",
            minimum: 1,
            maximum: 65534,
          },
          virtualDevice: {
            type: "integer",
            title: "Virtual device",
            description: "Object category — Audio = 3, Logic = 2.",
            default: 3,
            minimum: 0,
            maximum: 255,
          },
          minDb: {
            type: "number",
            title: "Bar minimum (dB)",
            description: "Signal level shown as an empty bar.",
            default: -80,
            minimum: -100,
            maximum: 0,
          },
          maxDb: {
            type: "number",
            title: "Bar maximum (dB)",
            description: "Signal level shown as a full bar.",
            default: 40,
            minimum: -40,
            maximum: 60,
          },
          meters: {
            type: "array",
            title: "Meters",
            description: "One bar per meter, in display order.",
            minItems: 1,
            items: {
              type: "object",
              required: ["label", "object"],
              properties: {
                label: { type: "string", title: "Label", minLength: 1 },
                object: {
                  type: "integer",
                  title: "Meter object id",
                  description: "24-bit Processing Object id of the meter.",
                  minimum: 0,
                  maximum: 16777215,
                },
                param: {
                  type: "integer",
                  title: "Parameter id",
                  description: "Parameter id of the meter value (usually 0).",
                  default: 0,
                  minimum: 0,
                  maximum: 65535,
                },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },

      // Meters are not Redis-backed state; they stream over a dedicated channel.
      stateSchema: { type: "object", properties: {} },

      // No commands: meters are read-only.
      commands: [],
    },
  ],
};
