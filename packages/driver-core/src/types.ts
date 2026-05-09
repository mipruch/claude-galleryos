import type { JSONSchema7 } from 'json-schema';

export interface DriverManifest {
  id: string;
  name: string;
  version: string;
  vendor: string;
  description?: string;
  connectionSchema: JSONSchema7;
  endpointTypes: EndpointTypeDefinition[];
  capabilities: {
    discovery: boolean;
    subscriptions: boolean;
    bidirectional: boolean;
  };
}

export interface EndpointTypeDefinition {
  type: string;
  name: string;
  description?: string;
  addressSchema: JSONSchema7;
  commands: CommandDefinition[];
  stateSchema: JSONSchema7;
}

export interface CommandDefinition {
  command: string;
  description: string;
  paramsSchema: JSONSchema7;
  reversible: boolean;
  estimatedDurationMs?: number;
}

export interface ConnectionConfig {
  id: string;
  driver: string;
  host: string;
  port: number;
  config: Record<string, unknown>;
}

export interface EndpointDescriptor {
  id: string;
  type: string;
  address: Record<string, unknown>;
  name: string;
}

export interface CommandResult {
  success: boolean;
  durationMs: number;
  state?: Record<string, unknown>;
  error?: string;
}

export interface HealthStatus {
  online: boolean;
  latencyMs?: number;
  details?: string;
  checkedAt: Date;
}

export interface StateChangeEvent {
  endpointId: string;
  state: Record<string, unknown>;
  source: 'subscription' | 'poll' | 'echo';
  timestamp: Date;
}

export interface DriverError {
  level: 'warning' | 'error' | 'fatal';
  message: string;
  endpointId?: string;
  cause?: unknown;
}

export interface DriverLogger {
  debug(msg: string, meta?: object): void;
  info(msg: string, meta?: object): void;
  warn(msg: string, meta?: object): void;
  error(msg: string, meta?: object): void;
}

export interface DriverKVStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DriverContext {
  logger: DriverLogger;
  storage: DriverKVStore;
  dryRun: boolean;
  signal: AbortSignal;
}
