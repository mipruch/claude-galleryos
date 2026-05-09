import type { EventEmitter } from 'events';
import type {
  CommandResult,
  ConnectionConfig,
  DriverContext,
  DriverManifest,
  EndpointDescriptor,
  HealthStatus,
} from './types';

export interface IDeviceDriver extends EventEmitter {
  readonly manifest: DriverManifest;

  init(config: ConnectionConfig, ctx: DriverContext): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;

  isConnected(): boolean;
  healthCheck(): Promise<HealthStatus>;
  endpointHealthCheck?(endpoint: EndpointDescriptor): Promise<HealthStatus>;

  executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>
  ): Promise<CommandResult>;

  readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>>;

  subscribeToEndpoint?(endpoint: EndpointDescriptor): Promise<void>;
  unsubscribeFromEndpoint?(endpoint: EndpointDescriptor): Promise<void>;

  discoverEndpoints?(): Promise<EndpointDescriptor[]>;
}
