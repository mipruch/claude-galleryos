import type { DriverManifest } from '@galleryos/driver-core';

export const manifest: DriverManifest = {
  id: 'bss-soundweb',
  name: 'BSS SoundWeb London',
  version: '1.0.0',
  vendor: 'Harman BSS',
  description:
    'BSS SoundWeb London (BLU-series) processor over HiQnet TCP (port 1023). Supports faders, mutes and parameter subscriptions.',
  connectionSchema: {
    type: 'object',
    required: ['host'],
    properties: {
      host: { type: 'string', title: 'Host / IP' },
      port: { type: 'integer', minimum: 1, maximum: 65535, default: 1023, title: 'Port' },
      nodeId: {
        type: 'integer',
        minimum: 0,
        maximum: 65535,
        title: 'Node ID',
        description: 'HiQnet node address of the processor (configured in London Architect).',
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
      type: 'bss.fader',
      name: 'BSS fader / parameter',
      addressSchema: {
        type: 'object',
        required: ['virtualDevice', 'object', 'parameter'],
        properties: {
          virtualDevice: { type: 'integer', minimum: 0, maximum: 255, title: 'Virtual device' },
          object: { type: 'integer', minimum: 0, maximum: 16777215, title: 'Object ID' },
          parameter: { type: 'integer', minimum: 0, maximum: 65535, title: 'Parameter ID' },
        },
      },
      stateSchema: {
        type: 'object',
        properties: {
          level: { type: 'number', minimum: 0, maximum: 1, description: 'Normalised 0..1 fader' },
          muted: { type: 'boolean' },
          rawValue: { type: 'integer' },
        },
      },
      commands: [
        {
          command: 'setLevel',
          description: 'Set fader level 0..1 (mapped to BSS dB scale)',
          reversible: true,
          paramsSchema: {
            type: 'object',
            required: ['level'],
            properties: { level: { type: 'number', minimum: 0, maximum: 1 } },
          },
        },
        {
          command: 'setMute',
          description: 'Mute or unmute',
          reversible: true,
          paramsSchema: {
            type: 'object',
            required: ['muted'],
            properties: { muted: { type: 'boolean' } },
          },
        },
        {
          command: 'subscribe',
          description: 'Subscribe to parameter changes',
          reversible: false,
          paramsSchema: { type: 'object', properties: {} },
        },
      ],
    },
  ],
};
