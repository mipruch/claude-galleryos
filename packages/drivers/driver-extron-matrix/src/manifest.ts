/**
 * Static manifest for the Extron matrix-switcher driver.
 *
 * Target: **Extron DTP CrossPoint 108 4K** — a 10×8 (10-input, 8-output)
 * presentation matrix switcher controlled over TCP 23 with the SIS protocol.
 *
 * Connection + endpoint model: one TCP socket per switcher (a `Connection`),
 * shared by every output. Each *output* is one `extron-matrix.output` endpoint
 * (a Device) that belongs to a room and exposes a single "which input?" choice —
 * so an 8-output unit becomes 8 devices under one connection. The 10×8 grid is
 * never surfaced as a grid; the UI only ever picks an input for one output.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "extron-matrix",
  name: "Extron Matrix Switcher",
  version: "0.1.0",
  vendor: "Extron",
  description:
    "Controls Extron matrix switchers (DTP CrossPoint 108 4K, CrossPoint, MAV Plus…) " +
    "over TCP using the SIS protocol. Each output is one endpoint that selects an input.",

  // Admin form for the connection. host/port map to ConnectionConfig.host/port;
  // the rest land in ConnectionConfig.config.
  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "hostname" },
      port: {
        type: "integer",
        title: "Port",
        description: "SIS control port (Telnet). Default 23.",
        default: 23,
        minimum: 1,
        maximum: 65535,
      },
      password: {
        type: "string",
        title: "Password",
        description:
          "Only required if the switcher has a control password set. Sent in " +
          "response to the device's `Password:` prompt on connect.",
      },
      inputCount: {
        type: "integer",
        title: "Inputs",
        description: "Number of inputs on the switcher (DTP CrossPoint 108 4K = 10).",
        default: 10,
        minimum: 1,
        maximum: 64,
      },
      outputCount: {
        type: "integer",
        title: "Outputs",
        description: "Number of outputs on the switcher (DTP CrossPoint 108 4K = 8).",
        default: 8,
        minimum: 1,
        maximum: 64,
      },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        default: 2000,
        minimum: 200,
        maximum: 10000,
      },
      reconnectMs: {
        type: "integer",
        title: "Reconnect delay (ms)",
        default: 2000,
        minimum: 250,
        maximum: 60000,
      },
    },
  },

  capabilities: {
    discovery: false,
    // Poll-based: the core reads via readState(). The driver still emits `state`
    // on unsolicited front-panel tie changes, so the UI stays live for free.
    subscriptions: false,
    bidirectional: true,
  },

  endpointTypes: [
    {
      type: "extron-matrix.output",
      name: "Matrix Output",
      description: "One output of the switcher; selects which input is routed to it.",

      addressSchema: {
        type: "object",
        required: ["output"],
        properties: {
          output: {
            type: "integer",
            title: "Output number",
            description: "Output (destination) number on the switcher, 1-based.",
            minimum: 1,
            maximum: 64,
          },
        },
        additionalProperties: false,
      },

      stateSchema: {
        type: "object",
        properties: {
          input: {
            type: "integer",
            description: "Input currently routed to this output (AV/video). 0 = none.",
          },
          audioInput: {
            type: "integer",
            description: "Audio input routed to this output, when read separately. 0 = none.",
          },
        },
      },

      commands: [
        {
          command: "setInput",
          description:
            "Route an input to this output (audio + video together). Input 0 unties " +
            "the output (blank).",
          paramsSchema: {
            type: "object",
            required: ["input"],
            properties: {
              input: {
                type: "integer",
                title: "Input",
                description: "Input number to route (0 = none).",
                minimum: 0,
                maximum: 64,
              },
            },
          },
        },
        {
          command: "setVideoInput",
          description: "Route only the video plane of an input to this output. 0 = none.",
          paramsSchema: {
            type: "object",
            required: ["input"],
            properties: {
              input: { type: "integer", title: "Input", minimum: 0, maximum: 64 },
            },
          },
        },
        {
          command: "setAudioInput",
          description: "Route only the audio plane of an input to this output. 0 = none.",
          paramsSchema: {
            type: "object",
            required: ["input"],
            properties: {
              input: { type: "integer", title: "Input", minimum: 0, maximum: 64 },
            },
          },
        },
      ],
    },
  ],
};
