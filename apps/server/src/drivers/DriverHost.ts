/**
 * DriverHost — manages one driver subprocess for one connection.
 *
 * Responsibilities (README §6, "DriverHost"):
 *  - Spawn the runtime harness as a Bun subprocess with IPC enabled.
 *  - Send it `init` + `connect`, forward commands, and match replies by id.
 *  - Re-emit driver events (`connected`/`disconnected`/`state`/`error`) so the
 *    DeviceManager can bridge them onto the EventBus.
 *  - On unexpected subprocess exit, restart with exponential backoff
 *    (base·2^n, capped at max), unless the host was stopped intentionally.
 *  - Serve the driver's KV storage requests from a host-provided backend.
 *
 * One DriverHost instance == one row in `connections`.
 */

import { EventEmitter } from "node:events";
import type { Subprocess } from "bun";
import type {
  CommandResult,
  ConnectionConfig,
  CoreToDriverMessage,
  DriverError,
  DriverKVStore,
  DriverToCoreMessage,
  EndpointDescriptor,
  HealthStatus,
  StateChangeEvent,
} from "@gallery/driver-core";
import type { Logger } from "../logger.ts";

/** Restart/backoff policy for a crashed subprocess. */
export interface RestartPolicy {
  /** 0 = unlimited. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface DriverHostOptions {
  connection: ConnectionConfig;
  logger: Logger;
  /** Backend for the driver's per-connection KV store (Redis namespace later). */
  storage: DriverKVStore;
  dryRun?: boolean;
  restart?: RestartPolicy;
  /** Default request timeout for commands/state/health (ms). */
  commandTimeoutMs?: number;
  /** Max time to wait for the subprocess to come up. */
  startTimeoutMs?: number;
  /** Override the runtime harness path (mainly for tests). */
  runtimePath?: string;
}

/** Details emitted on a `crashed` event. */
export interface CrashInfo {
  exitCode: number | null;
  signalCode: number | string | null;
  error?: Error;
  attempt: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_RUNTIME_PATH = `${import.meta.dir}/runtime.ts`;
const DISCOVERY_TIMEOUT_MS = 30_000;

export class DriverHost extends EventEmitter {
  private readonly connection: ConnectionConfig;
  private readonly logger: Logger;
  private readonly storage: DriverKVStore;
  private readonly dryRun: boolean;
  private readonly restart: RestartPolicy;
  private readonly commandTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly runtimePath: string;

  private proc: Subprocess<"ignore", "inherit", "inherit"> | null = null;
  private readonly pending = new Map<string, Pending>();
  private attempts = 0;
  private stopped = false;
  private connected = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** Resolves the in-flight `start()` on the next `ready`. */
  private onReadyOnce: (() => void) | null = null;

  constructor(options: DriverHostOptions) {
    super();
    this.connection = options.connection;
    this.logger = options.logger;
    this.storage = options.storage;
    this.dryRun = options.dryRun ?? false;
    this.restart = options.restart ?? { maxAttempts: 0, baseDelayMs: 1_000, maxDelayMs: 30_000 };
    this.commandTimeoutMs = options.commandTimeoutMs ?? 2_000;
    this.startTimeoutMs = options.startTimeoutMs ?? 8_000;
    this.runtimePath = options.runtimePath ?? DEFAULT_RUNTIME_PATH;
  }

  get connectionId(): string {
    return this.connection.id;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Spawn the subprocess and wait until it is ready (init + connect sent). */
  start(): Promise<void> {
    this.stopped = false;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onReadyOnce = null;
        reject(new Error(`driver host start timed out after ${this.startTimeoutMs}ms`));
      }, this.startTimeoutMs);
      this.onReadyOnce = () => {
        clearTimeout(timer);
        resolve();
      };
      this.spawnProcess();
    });
  }

  /** Gracefully stop: destroy the driver and kill the subprocess; no restart. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.rejectAllPending(new Error("driver host stopped"));
    const proc = this.proc;
    if (!proc) return;
    this.send({ kind: "destroy" });
    const killTimer = setTimeout(() => proc.kill(), 500);
    await proc.exited;
    clearTimeout(killTimer);
  }

  // ── driver API (proxied over IPC) ──────────────────────────

  executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    return this.request<CommandResult>(
      (requestId) => ({ kind: "executeCommand", requestId, endpoint, command, params }),
      this.commandTimeoutMs,
    );
  }

  readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    return this.request((requestId) => ({ kind: "readState", requestId, endpoint }), this.commandTimeoutMs);
  }

  healthCheck(): Promise<HealthStatus> {
    return this.request((requestId) => ({ kind: "healthCheck", requestId }), this.commandTimeoutMs);
  }

  endpointHealthCheck(endpoint: EndpointDescriptor): Promise<HealthStatus> {
    return this.request(
      (requestId) => ({ kind: "endpointHealthCheck", requestId, endpoint }),
      this.commandTimeoutMs,
    );
  }

  discoverEndpoints(): Promise<EndpointDescriptor[]> {
    return this.request((requestId) => ({ kind: "discoverEndpoints", requestId }), DISCOVERY_TIMEOUT_MS);
  }

  subscribeToEndpoint(endpoint: EndpointDescriptor): void {
    this.send({ kind: "subscribeToEndpoint", endpoint });
  }

  unsubscribeFromEndpoint(endpoint: EndpointDescriptor): void {
    this.send({ kind: "unsubscribeFromEndpoint", endpoint });
  }

  // ── typed events ───────────────────────────────────────────

  override on(event: "connected", listener: () => void): this;
  override on(event: "disconnected", listener: (reason: string) => void): this;
  override on(event: "state", listener: (e: StateChangeEvent) => void): this;
  override on(event: "error", listener: (e: DriverError) => void): this;
  override on(event: "crashed", listener: (info: CrashInfo) => void): this;
  override on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  // ── internals ──────────────────────────────────────────────

  private spawnProcess(): void {
    this.logger.debug("spawning driver subprocess", {
      driver: this.connection.driver,
      connectionId: this.connection.id,
    });
    this.proc = Bun.spawn({
      cmd: ["bun", this.runtimePath],
      ipc: (message) => this.onMessage(message as DriverToCoreMessage),
      onExit: (_proc, exitCode, signalCode, error) => this.onExit(exitCode, signalCode, error),
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env },
    });
  }

  private send(msg: CoreToDriverMessage): void {
    this.logger.debug("ipc tx → driver", ipcMeta(msg));
    this.proc?.send(msg);
  }

  private request<T>(
    build: (requestId: string) => CoreToDriverMessage,
    timeoutMs: number,
  ): Promise<T> {
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`driver request '${requestId}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send(build(requestId));
    });
  }

  private onMessage(msg: DriverToCoreMessage): void {
    // `log` messages are surfaced by their own handler below; don't double-log.
    if (msg.kind !== "log") this.logger.debug("ipc rx ← driver", ipcMeta(msg));
    switch (msg.kind) {
      case "ready":
        // Subprocess is up — (re)initialise and connect.
        this.send({ kind: "init", config: this.connection, dryRun: this.dryRun });
        this.send({ kind: "connect" });
        this.onReadyOnce?.();
        this.onReadyOnce = null;
        return;
      case "connected":
        this.attempts = 0;
        this.connected = true;
        this.emit("connected");
        return;
      case "disconnected":
        this.connected = false;
        this.emit("disconnected", msg.reason);
        return;
      case "state":
        this.emit("state", msg.event);
        return;
      case "error":
        this.logger[msg.error.level === "warning" ? "warn" : "error"](
          `driver error: ${msg.error.message}`,
          { level: msg.error.level, endpointId: msg.error.endpointId },
        );
        this.emit("error", msg.error);
        return;
      case "log":
        this.logger[msg.level](msg.message, msg.meta);
        return;
      case "reply": {
        const pending = this.pending.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(msg.requestId);
        msg.error ? pending.reject(new Error(msg.error)) : pending.resolve(msg.result);
        return;
      }
      case "storage.get":
        this.storage
          .get(msg.key)
          .then((value) => this.send({ kind: "storage.reply", requestId: msg.requestId, value }))
          .catch((err) =>
            this.send({ kind: "storage.reply", requestId: msg.requestId, error: errMsg(err) }),
          );
        return;
      case "storage.set":
        void this.storage.set(msg.key, msg.value);
        return;
      case "storage.delete":
        void this.storage.delete(msg.key);
        return;
    }
  }

  private onExit(
    exitCode: number | null,
    signalCode: number | string | null,
    error?: Error,
  ): void {
    this.connected = false;
    this.rejectAllPending(new Error("driver subprocess exited"));
    this.proc = null;

    if (this.stopped) {
      this.logger.info("driver subprocess stopped", { connectionId: this.connection.id });
      return;
    }

    this.attempts += 1;
    this.emit("crashed", { exitCode, signalCode, error, attempt: this.attempts } satisfies CrashInfo);

    if (this.restart.maxAttempts > 0 && this.attempts > this.restart.maxAttempts) {
      this.logger.error("driver gave up restarting", {
        connectionId: this.connection.id,
        attempts: this.attempts,
      });
      this.emit("disconnected", "restart attempts exhausted");
      return;
    }

    const delay = Math.min(
      this.restart.baseDelayMs * 2 ** (this.attempts - 1),
      this.restart.maxDelayMs,
    );
    this.logger.warn("driver subprocess crashed; scheduling restart", {
      connectionId: this.connection.id,
      driver: this.connection.driver,
      attempt: this.attempts,
      exitCode,
      delayMs: delay,
    });
    this.restartTimer = setTimeout(() => this.spawnProcess(), delay);
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Compact metadata for IPC trace logging. */
function ipcMeta(msg: CoreToDriverMessage | DriverToCoreMessage): Record<string, unknown> {
  const meta: Record<string, unknown> = { kind: msg.kind };
  if ("requestId" in msg && msg.requestId) meta.requestId = msg.requestId;
  if (msg.kind === "executeCommand") meta.command = msg.command;
  return meta;
}
