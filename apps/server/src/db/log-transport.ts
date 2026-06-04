/**
 * DbLogTransport — Winston transport that batches structured log entries into
 * the TimescaleDB `logs` hypertable via Drizzle.
 *
 * Writes are batched: flush fires every `flushIntervalMs` ms OR immediately
 * when `batchSize` records accumulate, whichever comes first. This prevents
 * per-row write pressure on high-frequency log bursts.
 *
 * Lifecycle:
 *   1. `new DbLogTransport(opts)` — construct (safe before DB is ready)
 *   2. `transport.start()` — arm the periodic flush timer
 *   3. `winstonRoot.add(transport)` — wire into the logger
 *   4. `await transport.stop()` — drain remaining entries on shutdown
 *
 * On insert failure the batch is discarded (not retried) to avoid an infinite
 * retry loop — the console and file transports already hold the same data.
 */

import Transport, { type TransportStreamOptions } from "winston-transport";
import { logs } from "@gallery/types/schema";
import type { LogRow } from "@gallery/types";
import { db } from "./client.ts";

/** Fields handled explicitly; everything else lands in `metadata`. */
const KNOWN_FIELDS = new Set([
  "level",
  "message",
  "source",
  "entityType",
  "entityId",
  "durationMs",
]);

export interface DbLogTransportOptions extends TransportStreamOptions {
  /** How often to flush the buffer (ms). Default: 500. */
  flushIntervalMs?: number;
  /** Max buffered entries before an immediate flush is triggered. Default: 50. */
  batchSize?: number;
  /** Injectable insert function — substitute a fake in tests. */
  insert?: (rows: LogRow[]) => Promise<void>;
}

export class DbLogTransport extends Transport {
  private buffer: LogRow[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** Serialised flush chain — prevents overlapping DB writes. */
  private flushChain: Promise<void> = Promise.resolve();
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly doInsert: (rows: LogRow[]) => Promise<void>;

  constructor(opts: DbLogTransportOptions = {}) {
    super(opts);
    this.flushIntervalMs = opts.flushIntervalMs ?? 500;
    this.batchSize = opts.batchSize ?? 50;
    this.doInsert =
      opts.insert ??
      (async (rows) => {
        await db.insert(logs).values(rows);
      });
  }

  /** Arm the periodic flush timer. Idempotent. */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
  }

  /** Clear the timer and flush any remaining buffered entries. */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // flush() chains onto the existing flushChain, so awaiting it also waits
    // for any in-flight flush to settle before writing the final batch.
    await this.flush();
  }

  override log(info: Record<string | symbol, unknown>, callback: () => void): void {
    setImmediate(() => this.emit("logged", info));

    // Collect non-reserved string keys into metadata.
    const metadata: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(info)) {
      if (!KNOWN_FIELDS.has(key)) metadata[key] = val;
    }

    this.buffer.push({
      ts: new Date(),
      level: String(info.level ?? "info"),
      source: String(info.source ?? "unknown"),
      message: String(info.message ?? ""),
      entityType: info.entityType != null ? String(info.entityType) : undefined,
      entityId: info.entityId != null ? String(info.entityId) : undefined,
      durationMs: typeof info.durationMs === "number" ? info.durationMs : undefined,
      metadata,
    });

    callback();

    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  private flush(): Promise<void> {
    this.flushChain = this.flushChain.then(async () => {
      if (this.buffer.length === 0) return;
      const batch = this.buffer.splice(0);
      try {
        await this.doInsert(batch);
      } catch (err) {
        process.stderr.write(
          `[DbLogTransport] flush failed (${batch.length} rows discarded): ${String(err)}\n`,
        );
      }
    });
    return this.flushChain;
  }
}

export const dbLogTransport = new DbLogTransport();
