// fallow-ignore-file unused-file

/**
 * Driver subprocess runtime harness (child side).
 *
 * Spawned by {@link ../drivers/DriverHost.ts | DriverHost} as `bun runtime.ts`.
 * It instantiates exactly one driver, wires the driver's EventEmitter events and
 * request/response calls to Bun's IPC, and exposes the host-provided context
 * (logger, KV storage, dry-run flag, abort signal) to the driver.
 *
 * Why a subprocess: a crashing or hanging driver cannot take down the core or
 * sibling drivers. The host restarts us with exponential backoff.
 *
 * Messages are processed strictly in order (a serial queue) so that, e.g.,
 * `init` always finishes before `connect`.
 */

import type {
  ConnectionConfig,
  CoreToDriverMessage,
  DriverContext,
  DriverError,
  DriverKVStore,
  DriverLogger,
  DriverToCoreMessage,
  IDeviceDriver,
  MeterUpdate,
  StateChangeEvent,
} from "@gallery/driver-core";
import { errMsg } from "@gallery/driver-core";
import { getDriverRegistration } from "./registry.ts";

// `process.send` exists because we were spawned with IPC enabled.
const send = (msg: DriverToCoreMessage): void => {
  process.send?.(msg);
};

const abort = new AbortController();
let driver: IDeviceDriver | undefined;

/** Pending storage.get calls awaiting a parent reply, keyed by requestId. */
const storagePending = new Map<string, (value: unknown, error?: string) => void>();

/** Logger that forwards to the parent's structured logger. */
const logger: DriverLogger = {
  debug: (message, meta) => send({ kind: "log", level: "debug", message, meta }),
  info: (message, meta) => send({ kind: "log", level: "info", message, meta }),
  warn: (message, meta) => send({ kind: "log", level: "warn", message, meta }),
  error: (message, meta) => send({ kind: "log", level: "error", message, meta }),
};

/** KV storage routed over IPC to the parent (which owns Redis). */
const storage: DriverKVStore = {
  get<T = unknown>(key: string): Promise<T | undefined> {
    const requestId = crypto.randomUUID();
    return new Promise<T | undefined>((resolve, reject) => {
      storagePending.set(requestId, (value, error) => {
        error ? reject(new Error(error)) : resolve(value as T | undefined);
      });
      send({ kind: "storage.get", requestId, key });
    });
  },
  async set(key, value) {
    send({ kind: "storage.set", key, value });
  },
  async delete(key) {
    send({ kind: "storage.delete", key });
  },
};

function buildContext(dryRun: boolean): DriverContext {
  return { logger, storage, dryRun, signal: abort.signal };
}

/** Bridge a driver's emitted events to IPC. */
function wireDriverEvents(d: IDeviceDriver): void {
  d.on("connected", () => send({ kind: "connected" }));
  d.on("disconnected", (reason: string) => send({ kind: "disconnected", reason }));
  d.on("state", (event: StateChangeEvent) => send({ kind: "state", event }));
  d.on("meter", (update: MeterUpdate) => send({ kind: "meter", update }));
  d.on("error", (error: DriverError) => send({ kind: "error", error }));
}

async function handleInit(config: ConnectionConfig, dryRun: boolean): Promise<void> {
  const registration = getDriverRegistration(config.driver);
  if (!registration) {
    send({ kind: "error", error: { level: "fatal", message: `unknown driver: ${config.driver}` } });
    return;
  }
  driver = new registration.DriverClass();
  wireDriverEvents(driver);
  await driver.init(config, buildContext(dryRun));
}

/**
 * Executes a handler function and sends an IPC reply with its result or error.
 *
 * @param requestId - The request identifier to include in the reply message
 * @param fn - The handler function to execute
 */
async function reply(requestId: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const result = await fn();
    send({ kind: "reply", requestId, result });
  } catch (err) {
    send({ kind: "reply", requestId, error: errMsg(err) });
  }
}

/**
 * Dispatches a single inbound IPC message to its appropriate handler.
 *
 * Routes initialization and storage replies without requiring the driver. For all other message kinds,
 * the driver must be initialized; requests with a `requestId` receive error replies if the driver is unavailable.
 */
async function handleMessage(msg: CoreToDriverMessage): Promise<void> {
  if (msg.kind === "init") {
    await handleInit(msg.config, msg.dryRun);
    return;
  }
  if (msg.kind === "storage.reply") {
    const resolver = storagePending.get(msg.requestId);
    if (resolver) {
      storagePending.delete(msg.requestId);
      resolver(msg.value, msg.error);
    }
    return;
  }

  const d = driver;
  if (!d) {
    if ("requestId" in msg) {
      send({ kind: "reply", requestId: msg.requestId, error: "driver not initialised" });
    }
    return;
  }

  switch (msg.kind) {
    case "connect":
      try {
        await d.connect();
      } catch (err) {
        send({ kind: "error", error: { level: "error", message: errMsg(err) } });
      }
      return;
    case "disconnect":
      await d.disconnect();
      return;
    case "destroy":
      await d.destroy();
      abort.abort();
      process.exit(0);
      return;
    case "executeCommand":
      return reply(msg.requestId, () => d.executeCommand(msg.endpoint, msg.command, msg.params));
    case "readState":
      return reply(msg.requestId, () => d.readState(msg.endpoint));
    case "healthCheck":
      return reply(msg.requestId, () => d.healthCheck());
    case "endpointHealthCheck":
      return reply(msg.requestId, () =>
        d.endpointHealthCheck
          ? d.endpointHealthCheck(msg.endpoint)
          : Promise.reject(new Error("endpointHealthCheck not supported")),
      );
    case "discoverEndpoints":
      return reply(msg.requestId, () =>
        d.discoverEndpoints
          ? d.discoverEndpoints()
          : Promise.reject(new Error("discovery not supported")),
      );
    case "subscribeToEndpoint":
      await d.subscribeToEndpoint?.(msg.endpoint);
      return;
    case "unsubscribeFromEndpoint":
      await d.unsubscribeFromEndpoint?.(msg.endpoint);
      return;
    case "meterSubscribe":
      await d.subscribeMeter?.(msg.address);
      return;
    case "meterUnsubscribe":
      await d.unsubscribeMeter?.(msg.address);
      return;
  }
}

// ── serial message pump ──────────────────────────────────────
// Messages are queued and processed one at a time, preserving order and
// ensuring async handlers don't interleave.
let pump: Promise<void> = Promise.resolve();
process.on("message", (raw: unknown) => {
  const msg = raw as CoreToDriverMessage;
  pump = pump.then(() => handleMessage(msg)).catch((err) => {
    send({ kind: "error", error: { level: "error", message: errMsg(err) } });
  });
});

// Never crash the subprocess on an unhandled driver error — report it instead.
process.on("uncaughtException", (err) => {
  send({ kind: "error", error: { level: "fatal", message: errMsg(err) } });
});
process.on("unhandledRejection", (reason) => {
  send({ kind: "error", error: { level: "error", message: errMsg(reason) } });
});

// Announce readiness so the parent knows it can send `init`.
send({ kind: "ready" });
