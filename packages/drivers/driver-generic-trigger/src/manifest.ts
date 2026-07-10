/**
 * Generic Trigger driver manifest.
 *
 * For the "I just need a button that fires off a message" case — a QLab cue
 * list, a relay box, anything reachable over a plain socket — without writing
 * a full driver. One connection = one destination (host:port); each device
 * under it is a row of fire-and-forget buttons, each button its own message.
 * Multiple devices can share one connection (e.g. "Qlab Jingles" and "Qlab
 * Alarms" both pointing at the same QLab instance, each with its own buttons)
 * — the button list lives on the *device* (`address.buttons`), not the
 * manifest, exactly like the BSS live-meter widget's `address.meters`.
 *
 * Three endpoint types, one per transport/encoding:
 *   - generic-trigger.tcp — raw text payload over TCP (connect → write → close).
 *   - generic-trigger.udp — raw text payload over UDP (one datagram).
 *   - generic-trigger.osc — an OSC 1.0 message over UDP (address pattern +
 *     optional space-separated arguments, auto-typed int/float/bool/string).
 *
 * No health probing (`capabilities.subscriptions`/`endpointHealth` both
 * omitted): this driver always reports itself online. A TCP-style reachability
 * probe would give false negatives for the UDP/OSC endpoint types (nothing is
 * "listening" on a UDP port in the TCP sense), and UDP has no reliable
 * reachability signal at all short of actually sending something. A failed
 * send surfaces as a command-failure toast instead — the honest signal for a
 * fire-and-forget protocol.
 *
 * Button item schemas are deliberately string-only (no booleans): the admin
 * form's array-of-object editor (`ArrayObjectField.vue`) only renders text/
 * number inputs.
 */

import type { DriverManifest } from "@gallery/driver-core";

const BUTTON_LABEL: Record<string, unknown> = {
  label: { type: "string", title: "Button label", minLength: 1 },
};

export const manifest: DriverManifest = {
  id: "generic-trigger",
  name: "Generic Trigger (TCP / UDP / OSC)",
  version: "0.1.0",
  vendor: "GalleryOS",
  description:
    "Fire-and-forget message buttons over TCP, UDP, or OSC-over-UDP, for simple " +
    "integrations (e.g. QLab) that don't warrant a full driver.",

  connectionSchema: {
    type: "object",
    required: ["host", "port"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "host" },
      port: { type: "integer", title: "Port", minimum: 1, maximum: 65535 },
      txDelimiter: {
        type: "string",
        title: "TX delimiter (TCP only)",
        description: "Appended to a TCP button's payload unless it opts out. Use \\r, \\n, \\r\\n.",
        default: "\r\n",
      },
      responseTimeoutMs: {
        type: "integer",
        title: "Connect timeout (ms, TCP only)",
        description: "How long to wait for the TCP socket to open before giving up.",
        default: 2000,
        minimum: 200,
        maximum: 30000,
      },
    },
  },

  capabilities: { discovery: false, subscriptions: false, bidirectional: false },

  endpointTypes: [
    {
      type: "generic-trigger.tcp",
      name: "TCP buttons",
      description: "Each button opens a TCP connection, writes its payload, and closes it.",
      addressSchema: {
        type: "object",
        required: ["buttons"],
        properties: {
          buttons: {
            type: "array",
            title: "Buttons",
            description: "One button per row, in display order.",
            minItems: 1,
            items: {
              type: "object",
              required: ["label", "payload"],
              properties: {
                ...BUTTON_LABEL,
                payload: { type: "string", title: "Payload", minLength: 1, description: "Sent as-is (UTF-8)." },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      stateSchema: { type: "object", properties: {} },
      commands: [
        {
          command: "send",
          description: "Open a TCP connection, write the payload, close it.",
          paramsSchema: {
            type: "object",
            required: ["payload"],
            properties: {
              payload: { type: "string", title: "Payload" },
              appendDelimiter: {
                type: "boolean",
                title: "Append TX delimiter",
                description: "Off sends the raw payload with no trailing delimiter.",
                default: true,
              },
            },
          },
        },
      ],
      widgets: [{ kind: "buttons", command: "send" }],
    },

    {
      type: "generic-trigger.udp",
      name: "UDP buttons",
      description: "Each button sends one raw UDP datagram.",
      addressSchema: {
        type: "object",
        required: ["buttons"],
        properties: {
          buttons: {
            type: "array",
            title: "Buttons",
            description: "One button per row, in display order.",
            minItems: 1,
            items: {
              type: "object",
              required: ["label", "payload"],
              properties: {
                ...BUTTON_LABEL,
                payload: {
                  type: "string",
                  title: "Payload",
                  minLength: 1,
                  description: "Sent as-is (UTF-8), one datagram.",
                },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      stateSchema: { type: "object", properties: {} },
      commands: [
        {
          command: "send",
          description: "Send one UDP datagram.",
          paramsSchema: {
            type: "object",
            required: ["payload"],
            properties: { payload: { type: "string", title: "Payload" } },
          },
        },
      ],
      widgets: [{ kind: "buttons", command: "send" }],
    },

    {
      type: "generic-trigger.osc",
      name: "OSC buttons",
      description: "Each button sends one OSC 1.0 message over UDP (e.g. to QLab).",
      addressSchema: {
        type: "object",
        required: ["buttons"],
        properties: {
          buttons: {
            type: "array",
            title: "Buttons",
            description: "One button per row, in display order.",
            minItems: 1,
            items: {
              type: "object",
              required: ["label", "address"],
              properties: {
                ...BUTTON_LABEL,
                address: {
                  type: "string",
                  title: "OSC address",
                  pattern: "^/",
                  minLength: 2,
                  examples: ["/go", "/cue/1/start", "/cue/2/level"],
                },
                args: {
                  type: "string",
                  title: "Arguments (optional)",
                  description:
                    "Space-separated. Each token is auto-typed: digits only → int, has a decimal " +
                    "point → float, true/false → bool, anything else → string. E.g. \"0.8\" " +
                    "for a level cue, or leave blank for a plain trigger like /go.",
                  examples: ["0.8", "1 hello"],
                },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      stateSchema: { type: "object", properties: {} },
      commands: [
        {
          command: "send",
          description: "Encode and send one OSC 1.0 message over UDP.",
          paramsSchema: {
            type: "object",
            required: ["address"],
            properties: {
              address: { type: "string", title: "OSC address", pattern: "^/" },
              args: {
                type: "string",
                title: "Arguments",
                description:
                  "Space-separated. Each token is auto-typed: digits only → int, has a decimal " +
                  "point → float, true/false → bool, anything else → string.",
              },
            },
          },
        },
      ],
      widgets: [{ kind: "buttons", command: "send" }],
    },
  ],
};
