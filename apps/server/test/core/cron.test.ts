/**
 * Cron tests — pure, deterministic (all times pinned via an explicit `from`).
 *
 * Covers field parsing (`*`, lists, ranges, steps), validation errors, Vixie
 * day-of-month/day-of-week OR-semantics, and the timezone-aware next-run search,
 * including the two DST cases the PLAN calls out (winter vs. summer offset and a
 * spring-forward boundary). All results are absolute UTC instants.
 */

import { describe, expect, test } from "bun:test";
import {
  CronParseError,
  computeNextRun,
  computeNextRuns,
  isValidCron,
  parseCron,
} from "../../src/core/cron.ts";

const iso = (d: Date) => d.toISOString();

describe("parseCron — validation", () => {
  test("accepts a standard 5-field expression", () => {
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
  });

  test("rejects the wrong field count", () => {
    expect(() => parseCron("0 9 * *")).toThrow(CronParseError);
    expect(() => parseCron("0 9 * * * *")).toThrow(CronParseError);
  });

  test("rejects out-of-range values", () => {
    expect(() => parseCron("60 9 * * *")).toThrow(CronParseError); // minute max 59
    expect(() => parseCron("0 24 * * *")).toThrow(CronParseError); // hour max 23
    expect(() => parseCron("0 9 0 * *")).toThrow(CronParseError); // dom min 1
    expect(() => parseCron("0 9 * 13 *")).toThrow(CronParseError); // month max 12
  });

  test("rejects malformed steps and reversed ranges", () => {
    expect(() => parseCron("*/0 9 * * *")).toThrow(CronParseError);
    expect(() => parseCron("0 9 10-5 * *")).toThrow(CronParseError);
    expect(() => parseCron("0 9 * * x")).toThrow(CronParseError);
  });

  test("normalises day-of-week 7 to Sunday (0)", () => {
    const c = parseCron("0 0 * * 7");
    expect(c.dayOfWeek.values.has(0)).toBe(true);
  });

  test("step expands across a range", () => {
    const c = parseCron("0-30/10 * * * *");
    expect([...c.minute.values].sort((a, b) => a - b)).toEqual([0, 10, 20, 30]);
  });
});

describe("computeNextRuns — basic UTC", () => {
  test("every 15 minutes", () => {
    const runs = computeNextRuns("*/15 * * * *", "UTC", 4, new Date("2026-06-21T10:07:00Z"));
    expect(runs.map(iso)).toEqual([
      "2026-06-21T10:15:00.000Z",
      "2026-06-21T10:30:00.000Z",
      "2026-06-21T10:45:00.000Z",
      "2026-06-21T11:00:00.000Z",
    ]);
  });

  test("daily at a fixed UTC time", () => {
    const run = computeNextRun("30 14 * * *", "UTC", new Date("2026-06-21T10:00:00Z"));
    expect(iso(run!)).toBe("2026-06-21T14:30:00.000Z");
  });

  test("the current minute is never re-fired", () => {
    // from is exactly on a 15-min mark; the next run must be the following one.
    const run = computeNextRun("*/15 * * * *", "UTC", new Date("2026-06-21T10:15:00Z"));
    expect(iso(run!)).toBe("2026-06-21T10:30:00.000Z");
  });

  test("weekdays only (1-5) skips the weekend", () => {
    // 2026-06-19 is a Friday; next weekday 08:00 runs skip Sat/Sun.
    const runs = computeNextRuns("0 8 * * 1-5", "UTC", 3, new Date("2026-06-19T12:00:00Z"));
    expect(runs.map(iso)).toEqual([
      "2026-06-22T08:00:00.000Z", // Mon
      "2026-06-23T08:00:00.000Z", // Tue
      "2026-06-24T08:00:00.000Z", // Wed
    ]);
  });
});

describe("computeNextRuns — Vixie DOM/DOW semantics", () => {
  test("both restricted matches on EITHER day-of-month or day-of-week", () => {
    // "1st of the month OR any Monday".
    const runs = computeNextRuns("0 0 1 * 1", "UTC", 4, new Date("2026-06-21T00:00:00Z"));
    expect(runs.map(iso)).toEqual([
      "2026-06-22T00:00:00.000Z", // Mon
      "2026-06-29T00:00:00.000Z", // Mon
      "2026-07-01T00:00:00.000Z", // 1st
      "2026-07-06T00:00:00.000Z", // Mon
    ]);
  });
});

describe("computeNextRuns — timezone & DST", () => {
  test("interprets the cron in the job timezone (winter offset)", () => {
    // 09:00 Europe/Prague in January is CET (UTC+1) → 08:00 UTC.
    const run = computeNextRun("0 9 * * *", "Europe/Prague", new Date("2026-01-15T00:00:00Z"));
    expect(iso(run!)).toBe("2026-01-15T08:00:00.000Z");
  });

  test("recomputes correctly for the summer offset (CEST)", () => {
    // 09:00 Europe/Prague in July is CEST (UTC+2) → 07:00 UTC.
    const run = computeNextRun("0 9 * * *", "Europe/Prague", new Date("2026-07-15T00:00:00Z"));
    expect(iso(run!)).toBe("2026-07-15T07:00:00.000Z");
  });

  test("handles the spring-forward boundary (offset changes mid-sequence)", () => {
    // Prague springs forward 2026-03-29 02:00→03:00. A daily 09:00 job moves from
    // 08:00 UTC (CET) the day before to 07:00 UTC (CEST) on/after the change.
    const runs = computeNextRuns("0 9 * * *", "Europe/Prague", 2, new Date("2026-03-28T12:00:00Z"));
    expect(runs.map(iso)).toEqual([
      "2026-03-29T07:00:00.000Z", // DST day, CEST
      "2026-03-30T07:00:00.000Z",
    ]);
  });

  test("rejects an invalid timezone", () => {
    expect(() => computeNextRun("0 9 * * *", "Mars/Olympus")).toThrow(CronParseError);
  });
});

describe("computeNextRuns — edge cases", () => {
  test("count <= 0 returns empty", () => {
    expect(computeNextRuns("* * * * *", "UTC", 0)).toEqual([]);
  });

  test("a rare expression (Feb 29) still resolves within the search bound", () => {
    // Next Feb 29 after 2026 is 2028 (leap year).
    const run = computeNextRun("0 0 29 2 *", "UTC", new Date("2026-06-21T00:00:00Z"));
    expect(iso(run!)).toBe("2028-02-29T00:00:00.000Z");
  });
});
