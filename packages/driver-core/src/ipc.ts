import type {
  ConnectionConfig,
  DriverError,
  EndpointDescriptor,
  StateChangeEvent,
} from './types';

export type CoreToDriverMessage =
  | { type: 'init'; config: ConnectionConfig; context: { dryRun: boolean } }
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'destroy' }
  | {
      type: 'executeCommand';
      requestId: string;
      endpoint: EndpointDescriptor;
      command: string;
      params: Record<string, unknown>;
    }
  | { type: 'readState'; requestId: string; endpoint: EndpointDescriptor }
  | { type: 'healthCheck'; requestId: string }
  | { type: 'subscribeToEndpoint'; endpoint: EndpointDescriptor }
  | { type: 'unsubscribeFromEndpoint'; endpoint: EndpointDescriptor }
  | { type: 'discoverEndpoints'; requestId: string };

export type DriverToCoreMessage =
  | { type: 'ready' }
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'state'; event: StateChangeEvent }
  | { type: 'error'; error: DriverError }
  | { type: 'reply'; requestId: string; result: unknown; error?: string }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; meta?: object };
