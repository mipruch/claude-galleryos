/**
 * Core driver type definitions.
 *
 * These types form the contract between the GalleryOS core and every driver.
 * A driver is a self-contained package that knows how to talk to one family of
 * physical devices. It MUST NOT access the database, Redis, or any other core
 * module directly — it only implements {@link IDeviceDriver} and exposes a
 * static {@link DriverManifest}.
 *
 * Two conceptual levels:
 *  - **Manifest types** describe a driver statically (without instantiating it),
 *    so the admin UI can render dynamic forms from JSON Schema.
 *  - **Runtime types** are the values exchanged while a driver is running.
 */

// ─────────────────────────────────────────────────────────────
// JSON Schema (minimal, dependency-free subset of JSON Schema draft-7)
// ─────────────────────────────────────────────────────────────

/**
 * A pragmatic, self-contained JSON Schema type. We avoid a hard dependency on
 * `@types/json-schema`; this covers everything our manifests need (and remains
 * structurally compatible with full JSON Schema for validators like Ajv later).
 */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];

  // object
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;

  // array
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;

  // string
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;

  // number / integer
  minimum?: number;
  maximum?: number;

  // any
  enum?: unknown[];
  const?: unknown;

  // Allow forward-compatible extra keywords without losing type safety elsewhere.
  [keyword: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Manifest types — static description of a driver
// ─────────────────────────────────────────────────────────────

/** A single command an endpoint type can execute (e.g. `setLevel`, `on`). */
export interface CommandDefinition {
  command: string;
  description: string;
  /** JSON Schema for the command's `params` object. */
  paramsSchema: JsonSchema;
}

/** A kind of addressable endpoint that can live under a connection. */
export interface EndpointTypeDefinition {
  /** Globally unique within the driver, formatted as `driver-id.type`. */
  type: string;
  name: string;
  description?: string;
  /** JSON Schema for `Device.address` of this endpoint type. */
  addressSchema: JsonSchema;
  /** JSON Schema describing the shape of `state` the driver emits. */
  stateSchema: JsonSchema;
  commands: CommandDefinition[];
}

/** What a driver can do — drives optional behaviour in the core. */
export interface DriverCapabilities {
  /** Can the driver automatically discover endpoints? */
  discovery: boolean;
  /** Can the device push state changes (vs. poll-only)? */
  subscriptions: boolean;
  /** Can current state be read back from the device? */
  bidirectional: boolean;
}

/** The static, instance-free description of a driver. */
export interface DriverManifest {
  /** Unique driver id, kebab-case, no vendor prefix (e.g. `pjlink`). */
  id: string;
  name: string;
  version: string;
  vendor: string;
  description?: string;
  /** JSON Schema for the connection's `config` (the gateway-level settings). */
  connectionSchema: JsonSchema;
  endpointTypes: EndpointTypeDefinition[];
  capabilities: DriverCapabilities;
}

// ─────────────────────────────────────────────────────────────
// Runtime types — values exchanged while a driver runs
// ─────────────────────────────────────────────────────────────

/** Resolved configuration for one physical connection / gateway. */
export interface ConnectionConfig {
  id: string;
  /** Driver id this connection uses (matches {@link DriverManifest.id}). */
  driver: string;
  host: string;
  port: number;
  /** Driver-specific config, validated against the manifest's connectionSchema. */
  config: Record<string, unknown>;
}

/** A logical, addressable endpoint (one row in the `devices` table). */
export interface EndpointDescriptor {
  /** UUID of the Device record. */
  id: string;
  /** Matches an {@link EndpointTypeDefinition.type}. */
  type: string;
  /** Driver-specific address, validated against the endpoint's addressSchema. */
  address: Record<string, unknown>;
  name: string;
}

/** Result of executing one command against one endpoint. */
export interface CommandResult {
  success: boolean;
  durationMs: number;
  /** New state after the command, when known. */
  state?: Record<string, unknown>;
  error?: string;
}

/** Health snapshot of a connection or endpoint. */
export interface HealthStatus {
  online: boolean;
  latencyMs?: number;
  details?: string;
  checkedAt: Date;
}

/** Emitted when an endpoint's state changes (subscription, poll, or echo). */
export interface StateChangeEvent {
  endpointId: string;
  state: Record<string, unknown>;
  source: "subscription" | "poll" | "echo";
  timestamp: Date;
}

/** A driver-reported error. `fatal` means the driver cannot recover itself. */
export interface DriverError {
  level: "warning" | "error" | "fatal";
  message: string;
  endpointId?: string;
  cause?: unknown;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured logger handed to a driver (forwards to the core logger). */
export interface DriverLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Per-driver persistent key-value store (a namespaced view of Redis). */
export interface DriverKVStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Everything a driver needs from its host, injected at {@link IDeviceDriver.init}. */
export interface DriverContext {
  logger: DriverLogger;
  storage: DriverKVStore;
  /** When true, the driver must simulate actions without touching hardware. */
  dryRun: boolean;
  /** Aborted when the driver is destroyed — drivers must honour it. */
  signal: AbortSignal;
}
