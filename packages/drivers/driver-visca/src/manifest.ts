/**
 * Static manifest for the VISCA over IP driver.
 *
 * VISCA is the industry-standard binary protocol for PTZ camera control,
 * originally developed by Sony and now supported by Panasonic, PTZOptics,
 * Vaddio, Marshall, and many others. This driver speaks VISCA over TCP
 * (port 5678 is the common default; some cameras use 52381).
 *
 * One connection = one camera. A camera has a single endpoint of type
 * `visca.camera`.
 */

import type { DriverManifest } from "@gallery/driver-core";

export const manifest: DriverManifest = {
  id: "visca",
  name: "VISCA PTZ Camera",
  version: "0.1.0",
  vendor: "VISCA (Sony/multi-vendor)",
  description:
    "Controls PTZ cameras via VISCA over TCP. Compatible with Sony, Panasonic, PTZOptics, Vaddio, Marshall and other VISCA-capable cameras.",

  connectionSchema: {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string", title: "Host / IP", format: "host" },
      port: {
        type: "integer",
        title: "Port",
        default: 5678,
        minimum: 1,
        maximum: 65535,
        description: "VISCA over TCP port. Common defaults: 5678 (PTZOptics), 52381 (VISCA/IP standard).",
      },
      cameraAddress: {
        type: "integer",
        title: "Camera address",
        default: 1,
        minimum: 1,
        maximum: 7,
        description: "VISCA camera address (1–7). Use 1 for a single camera on a direct TCP connection.",
      },
      responseTimeoutMs: {
        type: "integer",
        title: "Response timeout (ms)",
        default: 2000,
        minimum: 200,
        maximum: 10000,
      },
      pollIntervalMs: {
        type: "integer",
        title: "Status poll interval (ms)",
        default: 30000,
        minimum: 5000,
        maximum: 600000,
        description: "How often to query the camera's power state.",
      },
      streamUrl: {
        type: "string",
        title: "Stream URL (optional)",
        description:
          "RTSP or HLS stream URL for this camera. Shown in the admin preview panel. Leave blank if not applicable.",
      },
    },
  },

  capabilities: {
    discovery: false,
    subscriptions: true,
    bidirectional: true,
  },

  endpointTypes: [
    {
      type: "visca.camera",
      name: "PTZ Camera",
      description: "A single VISCA-controlled PTZ camera.",
      addressSchema: { type: "object", properties: {}, additionalProperties: false },
      stateSchema: {
        type: "object",
        properties: {
          power: { type: "string", enum: ["on", "off", "unknown"] },
          preset: { type: "integer", description: "Last recalled preset number (0-based)." },
        },
      },
      commands: [
        {
          command: "on",
          description: "Power the camera on.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "off",
          description: "Power the camera off (standby).",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "recallPreset",
          description: "Move the camera to a saved PTZ preset position.",
          paramsSchema: {
            type: "object",
            required: ["preset"],
            properties: {
              preset: {
                type: "integer",
                title: "Preset number",
                minimum: 0,
                maximum: 15,
                description: "Preset index 0–15.",
              },
            },
          },
        },
        {
          command: "savePreset",
          description: "Save the current camera position as a preset.",
          paramsSchema: {
            type: "object",
            required: ["preset"],
            properties: {
              preset: {
                type: "integer",
                title: "Preset number",
                minimum: 0,
                maximum: 15,
              },
            },
          },
        },
        {
          command: "home",
          description: "Move the camera to the home position.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "move",
          description: "Pan and/or tilt the camera.",
          paramsSchema: {
            type: "object",
            required: ["pan", "tilt"],
            properties: {
              pan: {
                type: "string",
                enum: ["left", "right", "stop"],
                title: "Pan direction",
              },
              tilt: {
                type: "string",
                enum: ["up", "down", "stop"],
                title: "Tilt direction",
              },
              panSpeed: {
                type: "integer",
                title: "Pan speed",
                minimum: 1,
                maximum: 18,
                default: 8,
              },
              tiltSpeed: {
                type: "integer",
                title: "Tilt speed",
                minimum: 1,
                maximum: 17,
                default: 8,
              },
            },
          },
        },
        {
          command: "zoomIn",
          description: "Start zooming in (tele). Send zoomStop to stop.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "zoomOut",
          description: "Start zooming out (wide). Send zoomStop to stop.",
          paramsSchema: { type: "object", properties: {} },
        },
        {
          command: "zoomStop",
          description: "Stop zoom movement.",
          paramsSchema: { type: "object", properties: {} },
        },
      ],
    },
  ],
};
