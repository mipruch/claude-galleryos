import type { DriverManifest } from '@galleryos/driver-core';

export const manifest: DriverManifest = {
  id: 'pjlink',
  name: 'PJLink',
  version: '1.0.0',
  vendor: 'JBMIA',
  description: 'PJLink Class 1 projector control over TCP (port 4352).',
  connectionSchema: {
    type: 'object',
    required: ['host'],
    properties: {
      host: { type: 'string', title: 'Host / IP' },
      port: { type: 'integer', minimum: 1, maximum: 65535, default: 4352, title: 'Port' },
      password: {
        type: 'string',
        title: 'Password (optional)',
        description: 'Required if projector authentication is enabled.',
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
      type: 'pjlink.projector',
      name: 'PJLink projector',
      addressSchema: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            title: 'Note',
            description: 'PJLink connections control a single projector. Address has no fields.',
          },
        },
      },
      stateSchema: {
        type: 'object',
        properties: {
          power: { type: 'string', enum: ['off', 'on', 'cooling', 'warmup', 'unknown'] },
          input: { type: 'string' },
        },
      },
      commands: [
        {
          command: 'on',
          description: 'Turn projector on',
          reversible: true,
          paramsSchema: { type: 'object', properties: {} },
          estimatedDurationMs: 30000,
        },
        {
          command: 'off',
          description: 'Turn projector off',
          reversible: true,
          paramsSchema: { type: 'object', properties: {} },
          estimatedDurationMs: 30000,
        },
        {
          command: 'setInput',
          description: 'Set input source (PJLink input code, e.g. 11=RGB1, 31=DIGITAL1)',
          reversible: true,
          paramsSchema: {
            type: 'object',
            required: ['input'],
            properties: { input: { type: 'string', pattern: '^[1-5][1-9]$' } },
          },
        },
        {
          command: 'getStatus',
          description: 'Query power status',
          reversible: false,
          paramsSchema: { type: 'object', properties: {} },
        },
      ],
    },
  ],
};
