/**
 * DbLogTransport tests — hermetic (no real DB).
 *
 * A fake `insert` function captures the batches the transport would write, so we
 * can assert on batching behaviour (size trigger, interval flush, field mapping,
 * drain-on-stop, error swallowing) without TimescaleDB.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { DbLogTransport } from "../../src/db/log-transport.ts";
import type { LogRow } from "@gallery/types";

/** Builds a transport with a capturing fake insert. */
function makeTransport(opts: { flushIntervalMs?: number; batchSize?: number } = {}) {
  const batches: LogRow[][] = [];
  const transport = new DbLogTransport({
    flushIntervalMs: opts.flushIntervalMs ?? 10_000, // long by default; tests trigger manually
    batchSize: opts.batchSize ?? 50,
    insert: async (rows) => {
      batches.push(rows);
    },
  });
  /** All rows across all flushed batches. */
  const allRows = () => batches.flat();
  return { transport, batches, allRows };
}

/** Emit a log record through the transport's Winston `log()` entry point. */
function emit(transport: DbLogTransport, info: Record<string, unknown>): void {
  transport.log(info as never, () => {});
}

async function waitFor(pred: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await Bun.sleep(5);
  }
}

describe("DbLogTransport", () => {
  let active: DbLogTransport | null = null;
  afterEach(async () => {
    if (active) await active.stop();
    active = null;
  });

  test("flushes immediately when batchSize is reached", async () => {
    const { transport, allRows } = makeTransport({ batchSize: 3 });
    active = transport;

    emit(transport, { level: "info", message: "a", source: "test" });
    emit(transport, { level: "info", message: "b", source: "test" });
    expect(allRows().length).toBe(0); // not yet at threshold

    emit(transport, { level: "info", message: "c", source: "test" });

    await waitFor(() => allRows().length === 3);
    expect(allRows().map((r) => r.message)).toEqual(["a", "b", "c"]);
  });

  test("flushes on the interval timer below the batch threshold", async () => {
    const { transport, allRows } = makeTransport({ flushIntervalMs: 20, batchSize: 50 });
    active = transport;
    transport.start();

    emit(transport, { level: "warn", message: "tick", source: "timer" });

    await waitFor(() => allRows().length === 1);
    expect(allRows()[0]?.message).toBe("tick");
  });

  test("maps known fields and folds the rest into metadata", async () => {
    const { transport, allRows } = makeTransport({ batchSize: 1 });
    active = transport;

    emit(transport, {
      level: "error",
      message: "command failed",
      source: "device_manager",
      entityType: "device",
      entityId: "dev-1",
      durationMs: 42,
      command: "setLevel",
      params: { level: 0.5 },
    });

    await waitFor(() => allRows().length === 1);
    const row = allRows()[0]!;
    expect(row.level).toBe("error");
    expect(row.message).toBe("command failed");
    expect(row.source).toBe("device_manager");
    expect(row.entityType).toBe("device");
    expect(row.entityId).toBe("dev-1");
    expect(row.durationMs).toBe(42);
    // Non-reserved keys land in metadata.
    expect(row.metadata).toEqual({ command: "setLevel", params: { level: 0.5 } });
  });

  test("applies defaults for missing fields", async () => {
    const { transport, allRows } = makeTransport({ batchSize: 1 });
    active = transport;

    emit(transport, { message: "bare" });

    await waitFor(() => allRows().length === 1);
    const row = allRows()[0]!;
    expect(row.level).toBe("info");
    expect(row.source).toBe("unknown");
    expect(row.entityType).toBeUndefined();
    expect(row.entityId).toBeUndefined();
    expect(row.durationMs).toBeUndefined();
  });

  test("stop() drains remaining buffered entries", async () => {
    const { transport, allRows } = makeTransport({ flushIntervalMs: 10_000, batchSize: 50 });

    emit(transport, { level: "info", message: "pending-1", source: "test" });
    emit(transport, { level: "info", message: "pending-2", source: "test" });
    expect(allRows().length).toBe(0); // neither timer nor threshold fired

    await transport.stop();
    expect(allRows().map((r) => r.message)).toEqual(["pending-1", "pending-2"]);
  });

  test("swallows insert errors without throwing", async () => {
    let calls = 0;
    const transport = new DbLogTransport({
      batchSize: 1,
      insert: async () => {
        calls++;
        throw new Error("DB down");
      },
    });
    active = transport;

    emit(transport, { level: "info", message: "x", source: "test" });

    await waitFor(() => calls === 1);
    // Buffer was cleared (batch discarded), transport still usable.
    emit(transport, { level: "info", message: "y", source: "test" });
    await waitFor(() => calls === 2);
    expect(calls).toBe(2);
  });

  test("flushes do not overlap (serialised chain)", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const transport = new DbLogTransport({
      batchSize: 1,
      insert: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await Bun.sleep(10);
        concurrent--;
      },
    });
    active = transport;

    // Fire several batch-triggered flushes in quick succession.
    emit(transport, { level: "info", message: "1", source: "t" });
    emit(transport, { level: "info", message: "2", source: "t" });
    emit(transport, { level: "info", message: "3", source: "t" });

    await Bun.sleep(60);
    expect(maxConcurrent).toBe(1);
  });
});
