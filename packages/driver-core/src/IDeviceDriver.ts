/**
 * The interface every driver implements.
 *
 * A driver extends Node/Bun's {@link EventEmitter} and emits the following:
 *  - `connected`    → ()                       physical link established
 *  - `disconnected` → (reason: string)         physical link lost
 *  - `state`        → (e: StateChangeEvent)     an endpoint's state changed
 *  - `meter`        → (u: MeterUpdate)          a live meter reading (push-only)
 *  - `error`        → (e: DriverError)          a recoverable/fatal driver error
 *
 * Drivers run inside a dedicated subprocess (see the runtime harness), so these
 * events are bridged across IPC to the core process by the DriverHost.
 *
 * Rules for driver authors (enforced by convention, see README §14):
 *  - Never call `process.exit()`. On a fatal condition emit `error` with
 *    `level: "fatal"` and wait for {@link IDeviceDriver.destroy}.
 *  - Always implement reconnect with exponential backoff.
 *  - Honour `ctx.signal` (AbortSignal) and `ctx.dryRun`.
 *  - Never import from the server or touch the database.
 */

import type { EventEmitter } from "node:events";
import type {
  CommandResult,
  ConnectionConfig,
  DriverContext,
  DriverManifest,
  EndpointDescriptor,
  HealthStatus,
} from "./types.ts";

export interface IDeviceDriver extends EventEmitter {
  /** Static description of this driver (same object as the exported manifest). */
  readonly manifest: DriverManifest;

  // ── Lifecycle ──────────────────────────────────────────────
  /** Receive configuration and host context. Called once before connect. */
  init(config: ConnectionConfig, ctx: DriverContext): Promise<void>;
  /** Open the physical connection. Emits `connected` on success. */
  connect(): Promise<void>;
  /** Close the physical connection gracefully. */
  disconnect(): Promise<void>;
  /** Release all resources. The driver is unusable afterwards. */
  destroy(): Promise<void>;

  // ── Status ─────────────────────────────────────────────────
  isConnected(): boolean;
  /** Connection-level health probe (used by the watchdog, layer 1). */
  healthCheck(): Promise<HealthStatus>;
  /** Optional per-endpoint health probe (watchdog layer 2). */
  endpointHealthCheck?(endpoint: EndpointDescriptor): Promise<HealthStatus>;

  // ── Commands ───────────────────────────────────────────────
  executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult>;

  /** Read the current state of an endpoint from the device. */
  readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>>;

  // ── Optional: subscriptions (only if capabilities.subscriptions) ──
  subscribeToEndpoint?(endpoint: EndpointDescriptor): Promise<void>;
  unsubscribeFromEndpoint?(endpoint: EndpointDescriptor): Promise<void>;

  // ── Optional: live meters (high-frequency, push-only) ──
  /**
   * Start streaming a meter parameter. The driver subscribes the device once and
   * emits a `meter` ({@link MeterUpdate}) on every reading. Idempotent: a repeat
   * call for the same address must not open a second device subscription.
   */
  subscribeMeter?(address: Record<string, unknown>): Promise<void>;
  /** Stop streaming a meter parameter previously started with {@link subscribeMeter}. */
  unsubscribeMeter?(address: Record<string, unknown>): Promise<void>;

  // ── Optional: discovery (only if capabilities.discovery) ──
  discoverEndpoints?(): Promise<EndpointDescriptor[]>;
}
