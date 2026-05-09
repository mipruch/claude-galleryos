import type { DriverManifest } from '@galleryos/driver-core';

export const manifest: DriverManifest = {
  id: 'tcp-generic',
  name: 'TCP Generic',
  version: '1.0.0',
  vendor: 'GalleryOS',
  description:
    'Configurable TCP driver for simple devices (relays, blinds, custom controllers). Sends raw newline-terminated strings.',
  connectionSchema: {
    type: 'object',
    required: ['host', 'port'],
    properties: {
      host: { type: 'string', title: 'Host / IP' },
      port: { type: 'integer', minimum: 1, maximum: 65535, default: 23, title: 'Port' },
      lineTerminator: {
        type: 'string',
        enum: ['\n', '\r\n', '\r'],
        default: '\n',
        title: 'Line terminator',
      },
    },
  },
  capabilities: {
    discovery: false,
    subscriptions: false,
    bidirectional: true,
  },
  endpointTypes: [
    {
      type: 'tcp-generic.endpoint',
      name: 'TCP endpoint',
      description: 'A single addressable channel on the TCP device.',
      addressSchema: {
        type: 'object',
        required: ['sendString'],
        properties: {
          sendString: {
            type: 'string',
            title: 'Send string template',
            description:
              'Raw string to send. Use {level}, {value}, {state} placeholders for parameter substitution.',
          },
          onString: { type: 'string', title: 'On payload (for on command)' },
          offString: { type: 'string', title: 'Off payload (for off command)' },
          expectAck: { type: 'boolean', default: false, title: 'Expect ACK reply' },
        },
      },
      stateSchema: {
        type: 'object',
        properties: {
          level: { type: 'number', minimum: 0, maximum: 1 },
          state: { type: 'string', enum: ['on', 'off'] },
          lastPayload: { type: 'string' },
        },
      },
      commands: [
        {
          command: 'send',
          description: 'Send raw payload (overrides sendString)',
          reversible: false,
          paramsSchema: {
            type: 'object',
            required: ['payload'],
            properties: { payload: { type: 'string' } },
          },
        },
        {
          command: 'setLevel',
          description: 'Substitute {level} (0..1) into sendString and send',
          reversible: true,
          paramsSchema: {
            type: 'object',
            required: ['level'],
            properties: { level: { type: 'number', minimum: 0, maximum: 1 } },
          },
        },
        {
          command: 'on',
          description: 'Send onString (or sendString)',
          reversible: true,
          paramsSchema: { type: 'object', properties: {} },
        },
        {
          command: 'off',
          description: 'Send offString (or sendString)',
          reversible: true,
          paramsSchema: { type: 'object', properties: {} },
        },
      ],
    },
  ],
};
